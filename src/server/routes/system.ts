import type { Express } from "express";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { RuntimeSettings } from "../types.js";
import { fetchSkills } from "../services/skills.js";
import {
  FileAccessError,
  listWorkspaceFiles,
  loadIgnoreRules,
  normalizeRelativePath,
  readWorkspaceTextFile,
  resolveWorkspacePath,
  writeWorkspaceTextFile
} from "../services/files.js";
import { listSessionSummaries, readSessionMessages } from "../services/sessions.js";
import { maskToken, readSettings, writeSettings } from "../services/settings.js";
import { WorkspaceRegistry } from "../services/workspaces.js";
import { buildQueryOptions, withTimeout } from "../services/query.js";
import { readMcpConfig } from "../services/mcp.js";
import { syncSettingsToDotenv } from "../services/dotenv-sync.js";

type SystemRoutesDeps = {
  app: Express;
  workspaceRegistry: WorkspaceRegistry;
  defaultSettings: RuntimeSettings;
  activeQueries: Map<string, ReturnType<typeof query>>;
};

type McpRuntimeRow = {
  connected: boolean | null;
  status: string;
  error: string;
};

type McpProbeSnapshot = {
  ok: boolean | null;
  error: string;
  source: string;
  checking: boolean;
  checkedAt: number;
  rows: Map<string, McpRuntimeRow>;
};

export function registerSystemRoutes({ app, workspaceRegistry, defaultSettings, activeQueries }: SystemRoutesDeps): void {
  const mcpProbeCache = new Map<string, McpProbeSnapshot>();
  const parseRuntimeEnvText = (text: string): Record<string, string> => {
    const out: Record<string, string> = {};
    const lines = String(text || "").split(/\r?\n/);
    for (const line of lines) {
      const raw = line.trim();
      if (!raw || raw.startsWith("#")) continue;
      const idx = raw.indexOf("=");
      if (idx <= 0) continue;
      const key = raw.slice(0, idx).trim();
      const value = raw.slice(idx + 1).trim();
      if (!key || !value) continue;
      out[key] = value;
    }
    return out;
  };
  const settingsEnvValue = (name: string, settings: RuntimeSettings): string => {
    const fromProcess = String(process.env[name] || "").trim();
    if (fromProcess) return fromProcess;
    const fromMap = String(settings.runtimeEnv?.[name] || "").trim();
    if (fromMap) return fromMap;
    if (name === "ANTHROPIC_AUTH_TOKEN") return settings.authToken;
    return "";
  };

  const getMcpSnapshot = (workspaceId: string): McpProbeSnapshot => {
    const existing = mcpProbeCache.get(workspaceId);
    if (existing) return existing;
    const created: McpProbeSnapshot = {
      ok: null,
      error: "",
      source: "none",
      checking: false,
      checkedAt: 0,
      rows: new Map<string, McpRuntimeRow>()
    };
    mcpProbeCache.set(workspaceId, created);
    return created;
  };

  const findActiveWorkspaceQuery = (workspaceId: string): ReturnType<typeof query> | null => {
    let activeQuery: ReturnType<typeof query> | null = null;
    for (const [key, value] of activeQueries) {
      if (key.startsWith(`${workspaceId}:`)) activeQuery = value;
    }
    return activeQuery;
  };

  const startMcpProbe = (workspaceId: string): { started: boolean; reason: string } => {
    const snapshot = getMcpSnapshot(workspaceId);
    if (snapshot.checking) return { started: false, reason: "already_checking" };

    const activeQuery = findActiveWorkspaceQuery(workspaceId);
    if (!activeQuery) {
      snapshot.ok = null;
      snapshot.error = "No active chat session.";
      snapshot.source = "active_session_missing";
      snapshot.checkedAt = Date.now();
      return { started: false, reason: "no_active_session" };
    }

    snapshot.checking = true;
    snapshot.error = "";
    snapshot.source = "active_session";
    void (async () => {
      try {
        const rawStatus = await withTimeout(activeQuery.mcpServerStatus(), 10000, "mcpServerStatus");
        snapshot.rows.clear();
        for (const entry of Array.isArray(rawStatus) ? rawStatus : []) {
          if (!entry || typeof entry !== "object") continue;
          const row = entry as Record<string, unknown>;
          const name =
            (typeof row.name === "string" && row.name) ||
            (typeof row.server === "string" && row.server) ||
            (typeof row.id === "string" && row.id) ||
            "";
          if (!name) continue;
          const connectedRaw = row.connected;
          const connected = typeof connectedRaw === "boolean" ? connectedRaw : null;
          const status = typeof row.status === "string" ? row.status : connected === true ? "connected" : "unknown";
          const error = typeof row.error === "string" ? row.error : "";
          snapshot.rows.set(name, { connected, status, error });
        }
        snapshot.ok = true;
        snapshot.error = "";
        snapshot.source = "active_session";
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        snapshot.error = msg;
        if (msg.includes("Query closed before response received") || msg.includes("ProcessTransport is not ready")) {
          snapshot.ok = null;
          snapshot.source = "active_session_unavailable";
        } else {
          snapshot.ok = false;
          snapshot.source = "active_session_error";
        }
      } finally {
        snapshot.checkedAt = Date.now();
        snapshot.checking = false;
      }
    })();

    return { started: true, reason: "started" };
  };

  app.get("/api/workspaces", (_req, res) => {
    res.json({
      ok: true,
      currentWorkspaceId: workspaceRegistry.defaultWorkspace?.id || "",
      items: Array.from(workspaceRegistry.map.values())
    });
  });

  app.get("/api/health", async (req, res) => {
    const workspace = workspaceRegistry.requireWorkspace(req, res);
    if (!workspace) return;
    const settings = await readSettings(workspace.root, defaultSettings);
    res.json({
      ok: true,
      transport: "ui-message-stream",
      askQuestion: true,
      workspaceId: workspace.id,
      workspaceRoot: workspace.root,
      hooksMode: settings.speedModeEnabled ? "disabled-by-speed-mode" : "project-hooks-enabled"
    });
  });

  app.get("/api/settings", async (req, res) => {
    const workspace = workspaceRegistry.requireWorkspace(req, res);
    if (!workspace) return;
    const settings = await readSettings(workspace.root, defaultSettings);
    const configured = await readMcpConfig(workspace.root);
    const requiredEnvKeys = Array.from(new Set(configured.flatMap((item) => item.requiredEnvVars || [])));
    const runtimeEnvView: Record<string, string> = { ...(settings.runtimeEnv || {}) };
    for (const key of requiredEnvKeys) {
      const value = settingsEnvValue(key, settings).trim();
      if (!value) continue;
      runtimeEnvView[key] = value;
    }
    res.json({
      workspaceId: workspace.id,
      workspaceRoot: workspace.root,
      model: settings.model,
      baseUrl: settings.baseUrl,
      runtimeEnv: runtimeEnvView,
      permissionProfile: settings.permissionProfile,
      mcpEnabled: settings.mcpEnabled,
      speedModeEnabled: settings.speedModeEnabled,
      toolGateEnabled: settings.toolGateEnabled,
      debugEnabled: settings.debugEnabled,
      debugSseEnabled: settings.debugSseEnabled,
      hasToken: Boolean(settings.authToken),
      tokenPreview: maskToken(settings.authToken)
    });
  });

  app.get("/api/skills", async (req, res) => {
    try {
      const workspace = workspaceRegistry.requireWorkspace(req, res);
      if (!workspace) return;
      const settings = await readSettings(workspace.root, defaultSettings);
      const items = await fetchSkills(workspace.root, settings, { buildQueryOptions, withTimeout });
      res.json({
        ok: true,
        workspaceId: workspace.id,
        count: items.length,
        source: "claude-agent-sdk-supportedCommands+local-owned-filter",
        items
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ ok: false, error: msg, items: [] });
    }
  });

  app.get("/api/mcps", async (req, res) => {
    try {
      const workspace = workspaceRegistry.requireWorkspace(req, res);
      if (!workspace) return;
      const settings = await readSettings(workspace.root, defaultSettings);
      const configured = await readMcpConfig(workspace.root);
      const snapshot = getMcpSnapshot(workspace.id);
      const ageSeconds = snapshot.checkedAt > 0 ? Math.max(0, Math.floor((Date.now() - snapshot.checkedAt) / 1000)) : null;
      const stale = ageSeconds !== null ? ageSeconds > 60 : true;

      const items = configured.map((item) => {
        const runtime = snapshot.rows.get(item.name) || null;
        const missingEnvVars = item.requiredEnvVars.filter((name) => {
          return !settingsEnvValue(name, settings).trim();
        });
        const defaultRuntime =
          settings.mcpEnabled === false
            ? { connected: null, status: "disabled", error: "" }
            : missingEnvVars.length > 0
              ? { connected: false, status: "missing_env", error: `Missing env: ${missingEnvVars.join(", ")}` }
              : snapshot.checking
                ? { connected: null, status: "checking", error: "" }
                : snapshot.ok === false
                  ? { connected: null, status: "probe_failed", error: snapshot.error }
                : { connected: null, status: "not_checked", error: "" };
        return {
          ...item,
          enabled: settings.mcpEnabled,
          missingEnvVars,
          runtime: runtime
            ? {
                connected: runtime.connected,
                status: runtime.status,
                error: runtime.error
              }
            : defaultRuntime
        };
      });

      res.json({
        ok: true,
        workspaceId: workspace.id,
        mcpEnabled: settings.mcpEnabled,
        count: items.length,
        runtime: {
          ok: snapshot.ok,
          error: snapshot.error,
          source: snapshot.source,
          checking: snapshot.checking,
          lastCheckedAt: snapshot.checkedAt || null,
          ageSeconds,
          stale
        },
        items
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({
        ok: false,
        error: msg,
        mcpEnabled: false,
        count: 0,
        runtime: { ok: false, error: msg },
        items: []
      });
    }
  });

  app.post("/api/mcps/refresh", async (req, res) => {
    try {
      const workspace = workspaceRegistry.requireWorkspace(req, res);
      if (!workspace) return;
      const settings = await readSettings(workspace.root, defaultSettings);
      const configured = await readMcpConfig(workspace.root);
      const snapshot = getMcpSnapshot(workspace.id);

      if (!settings.mcpEnabled) {
        snapshot.ok = null;
        snapshot.error = "";
        snapshot.source = "disabled";
        snapshot.checking = false;
        snapshot.checkedAt = Date.now();
        res.json({ ok: true, started: false, reason: "mcp_disabled", runtime: snapshot });
        return;
      }

      if (configured.length === 0) {
        snapshot.ok = null;
        snapshot.error = "";
        snapshot.source = "config_empty";
        snapshot.checking = false;
        snapshot.checkedAt = Date.now();
        res.json({ ok: true, started: false, reason: "config_empty", runtime: snapshot });
        return;
      }

      const result = startMcpProbe(workspace.id);
      const fresh = getMcpSnapshot(workspace.id);
      res.json({
        ok: true,
        workspaceId: workspace.id,
        started: result.started,
        reason: result.reason,
        runtime: {
          ok: fresh.ok,
          error: fresh.error,
          source: fresh.source,
          checking: fresh.checking,
          lastCheckedAt: fresh.checkedAt || null
        }
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ ok: false, error: msg });
    }
  });

  app.get("/api/files", async (req, res) => {
    try {
      const workspace = workspaceRegistry.requireWorkspace(req, res);
      if (!workspace) return;
      const relativePath = normalizeRelativePath(req.query?.path);
      const depthRaw = Number(req.query?.depth ?? 1);
      const depth = Number.isFinite(depthRaw) ? Math.min(Math.max(Math.floor(depthRaw), 1), 3) : 1;

      const abs = resolveWorkspacePath(workspace.root, relativePath);
      if (!abs) {
        res.status(400).json({ ok: false, error: "invalid path" });
        return;
      }

      const rules = await loadIgnoreRules(workspace.root);
      const items = await listWorkspaceFiles(workspace.root, relativePath, depth, rules);
      res.json({
        ok: true,
        workspaceId: workspace.id,
        root: workspace.root,
        path: relativePath,
        depth,
        count: items.length,
        items
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "unknown error";
      res.status(500).json({ ok: false, error: msg, items: [] });
    }
  });

  app.get("/api/file", async (req, res) => {
    try {
      const workspace = workspaceRegistry.requireWorkspace(req, res);
      if (!workspace) return;
      const relativePath = normalizeRelativePath(req.query?.path);
      const file = await readWorkspaceTextFile(workspace.root, relativePath);
      res.json({
        ok: true,
        workspaceId: workspace.id,
        ...file
      });
    } catch (error) {
      if (error instanceof FileAccessError) {
        res.status(error.statusCode).json({ ok: false, error: error.message });
        return;
      }
      const msg = error instanceof Error ? error.message : "unknown error";
      res.status(500).json({ ok: false, error: msg });
    }
  });

  app.get("/api/sessions", async (req, res) => {
    try {
      const workspace = workspaceRegistry.requireWorkspace(req, res);
      if (!workspace) return;
      const items = await listSessionSummaries(workspace.root);
      res.json({
        ok: true,
        workspaceId: workspace.id,
        count: items.length,
        items
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "unknown error";
      res.status(500).json({ ok: false, error: msg, items: [] });
    }
  });

  app.get("/api/sessions/:sessionId", async (req, res) => {
    try {
      const workspace = workspaceRegistry.requireWorkspace(req, res);
      if (!workspace) return;
      const sessionId = typeof req.params?.sessionId === "string" ? req.params.sessionId : "";
      if (!sessionId) {
        res.status(400).json({ ok: false, error: "sessionId is required" });
        return;
      }
      const messages = await readSessionMessages(workspace.root, sessionId);
      if (!messages) {
        res.status(404).json({ ok: false, error: "session not found", messages: [] });
        return;
      }
      res.json({
        ok: true,
        workspaceId: workspace.id,
        sessionId,
        messages: messages.map((m) => ({
          id: m.id,
          role: m.role,
          parts: [{ type: "text", text: m.text }],
          toolTrace: m.toolTrace || null
        }))
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "unknown error";
      res.status(500).json({ ok: false, error: msg, messages: [] });
    }
  });

  app.post("/api/settings", async (req, res) => {
    const workspace = workspaceRegistry.requireWorkspace(req, res);
    if (!workspace) return;

    const current = await readSettings(workspace.root, defaultSettings);
    const model = typeof req.body?.model === "string" ? req.body.model.trim() : current.model;
    const baseUrl = typeof req.body?.baseUrl === "string" ? req.body.baseUrl.trim() : current.baseUrl;
    const tokenInput = typeof req.body?.authToken === "string" ? req.body.authToken.trim() : "";
    const runtimeEnvTextRaw = typeof req.body?.runtimeEnvText === "string" ? req.body.runtimeEnvText : null;
    const nextRuntimeEnv: Record<string, string> = {};
    if (runtimeEnvTextRaw !== null) {
      Object.assign(nextRuntimeEnv, parseRuntimeEnvText(runtimeEnvTextRaw));
    } else {
      const runtimeEnvUpdatesRaw = req.body?.runtimeEnvUpdates;
      const runtimeEnvUpdates =
        runtimeEnvUpdatesRaw && typeof runtimeEnvUpdatesRaw === "object" && !Array.isArray(runtimeEnvUpdatesRaw)
          ? (runtimeEnvUpdatesRaw as Record<string, unknown>)
          : {};
      Object.assign(nextRuntimeEnv, current.runtimeEnv || {});
      for (const [rawKey, rawValue] of Object.entries(runtimeEnvUpdates)) {
        const key = String(rawKey || "").trim();
        if (!key) continue;
        const value = typeof rawValue === "string" ? rawValue.trim() : "";
        if (!value) delete nextRuntimeEnv[key];
        else nextRuntimeEnv[key] = value;
      }
    }
    const permissionProfileRaw = req.body?.permissionProfile;
    const permissionProfile =
      permissionProfileRaw === "standard" || permissionProfileRaw === "accept_edits" || permissionProfileRaw === "full_auto"
        ? permissionProfileRaw
        : current.permissionProfile;
    const mcpEnabled = typeof req.body?.mcpEnabled === "boolean" ? req.body.mcpEnabled : current.mcpEnabled;
    const speedModeEnabled =
      typeof req.body?.speedModeEnabled === "boolean" ? req.body.speedModeEnabled : current.speedModeEnabled;
    const requestedToolGateEnabled =
      typeof req.body?.toolGateEnabled === "boolean" ? req.body.toolGateEnabled : current.toolGateEnabled;
    const toolGateEnabled = permissionProfile === "standard" ? requestedToolGateEnabled : false;
    const debugEnabled = typeof req.body?.debugEnabled === "boolean" ? req.body.debugEnabled : current.debugEnabled;
    const debugSseEnabled =
      typeof req.body?.debugSseEnabled === "boolean" ? req.body.debugSseEnabled : current.debugSseEnabled;
    const keepExistingToken = req.body?.keepExistingToken !== false;
    const syncDotenv = req.body?.syncDotenv === true;

    const next: RuntimeSettings = {
      model: model || current.model,
      baseUrl: baseUrl || current.baseUrl,
      authToken: tokenInput ? tokenInput : keepExistingToken ? current.authToken : "",
      runtimeEnv: nextRuntimeEnv,
      permissionProfile,
      mcpEnabled,
      speedModeEnabled,
      toolGateEnabled,
      debugEnabled,
      debugSseEnabled
    };

    await writeSettings(workspace.root, next);
    let dotenvSync: { synced: boolean; envFile?: string; keyCount?: number; error?: string } = { synced: false };
    if (syncDotenv) {
      try {
        const synced = await syncSettingsToDotenv(workspace.root, next);
        dotenvSync = { synced: true, envFile: synced.envFile, keyCount: synced.keys.length };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        dotenvSync = { synced: false, error: msg };
      }
    }
    res.json({
      ok: true,
      workspaceId: workspace.id,
      workspaceRoot: workspace.root,
      model: next.model,
      baseUrl: next.baseUrl,
      runtimeEnv: next.runtimeEnv,
      permissionProfile: next.permissionProfile,
      mcpEnabled: next.mcpEnabled,
      speedModeEnabled: next.speedModeEnabled,
      toolGateEnabled: next.toolGateEnabled,
      debugEnabled: next.debugEnabled,
      debugSseEnabled: next.debugSseEnabled,
      hasToken: Boolean(next.authToken),
      tokenPreview: maskToken(next.authToken),
      dotenvSync
    });
  });

  app.post("/api/settings/sync-dotenv", async (req, res) => {
    const workspace = workspaceRegistry.requireWorkspace(req, res);
    if (!workspace) return;
    const current = await readSettings(workspace.root, defaultSettings);
    const synced = await syncSettingsToDotenv(workspace.root, current);
    res.json({
      ok: true,
      workspaceId: workspace.id,
      envFile: synced.envFile,
      keyCount: synced.keys.length,
      keys: synced.keys
    });
  });

  app.put("/api/file", async (req, res) => {
    try {
      const workspace = workspaceRegistry.requireWorkspace(req, res);
      if (!workspace) return;
      const relativePath = normalizeRelativePath(req.body?.path);
      const content = typeof req.body?.content === "string" ? req.body.content : "";
      const expectedMtimeMs = typeof req.body?.expectedMtimeMs === "number" ? req.body.expectedMtimeMs : null;

      if (!relativePath) {
        res.status(400).json({ ok: false, error: "invalid path" });
        return;
      }

      const result = await writeWorkspaceTextFile(workspace.root, relativePath, content, expectedMtimeMs);
      res.json({
        ok: true,
        workspaceId: workspace.id,
        ...result
      });
    } catch (error) {
      if (error instanceof FileAccessError) {
        res.status(error.statusCode).json({ ok: false, error: error.message });
        return;
      }
      const msg = error instanceof Error ? error.message : "unknown error";
      res.status(500).json({ ok: false, error: msg });
    }
  });
}
