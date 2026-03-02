import type { Express } from "express";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { promises as fs } from "node:fs";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { RuntimeSettings } from "../types.js";
import { fetchSkills, invalidateSkillsCache } from "../services/skills.js";
import {
  FileAccessError,
  listWorkspaceFiles,
  loadIgnoreRules,
  normalizeRelativePath,
  readWorkspaceTextFile,
  resolveWorkspacePath,
  searchWorkspaceFilesByName,
  writeWorkspaceTextFile
} from "../services/files.js";
import { listSessionSummaries, readSessionMessages, deleteSession } from "../services/sessions.js";
import { maskToken, readSettings, writeSettings } from "../services/settings.js";
import { WorkspaceRegistry } from "../services/workspaces.js";
import { buildQueryOptions, withTimeout } from "../services/query.js";
import { readMcpConfig } from "../services/mcp.js";
import { hasEffectiveEnvValue, parseEnvText, readWorkspaceDotenv } from "../services/env.js";
import type { SessionRuntimeManager } from "../services/session-runtime.js";
import { clearSlashNamesCache } from "./chat-ui-slash-cache.js";

type SystemRoutesDeps = {
  app: Express;
  workspaceRegistry: WorkspaceRegistry;
  defaultSettings: RuntimeSettings;
  activeQueries?: Map<string, { mcpServerStatus: () => Promise<unknown[]> }>;
  sessionRuntimeManager?: SessionRuntimeManager;
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

type AgentRow = {
  name: string;
  description: string;
  model: string;
};

type AgentsSnapshot = {
  checkedAt: number;
  items: AgentRow[];
};

function parseFrontmatterValue(raw: string, key: string): string {
  const lines = raw.split(/\r?\n/);
  if (lines.length < 3 || lines[0].trim() !== "---") return "";
  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === "---") {
      end = i;
      break;
    }
  }
  if (end <= 1) return "";
  const prefix = `${key.toLowerCase()}:`;
  for (let i = 1; i < end; i += 1) {
    const line = lines[i].trim();
    if (!line.toLowerCase().startsWith(prefix)) continue;
    return line.slice(prefix.length).trim().replace(/^['"]|['"]$/g, "");
  }
  return "";
}

async function collectProjectAgents(workspaceRoot: string): Promise<AgentRow[]> {
  const agentsDir = path.join(workspaceRoot, ".claude", "agents");
  try {
    const entries = await fs.readdir(agentsDir, { withFileTypes: true });
    const rows = await Promise.all(
      entries.map(async (entry) => {
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) return null;
        const abs = path.join(agentsDir, entry.name);
        const baseName = entry.name.replace(/\.md$/i, "").trim();
        try {
          const raw = await fs.readFile(abs, "utf-8");
          const name = parseFrontmatterValue(raw, "name").trim() || baseName;
          if (!name) return null;
          const description = parseFrontmatterValue(raw, "description").trim();
          return { name, description, model: "" };
        } catch {
          if (!baseName) return null;
          return { name: baseName, description: "", model: "" };
        }
      })
    );
    return rows
      .filter((row): row is AgentRow => Boolean(row?.name))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export function registerSystemRoutes({
  app,
  workspaceRegistry,
  defaultSettings,
  activeQueries,
  sessionRuntimeManager
}: SystemRoutesDeps): void {
  const mcpProbeCache = new Map<string, McpProbeSnapshot>();
  const agentsCache = new Map<string, AgentsSnapshot>();
  const mcpProbeTtlMsRaw = Number(process.env.AGENT_WEB_MCP_PROBE_TTL_MS || "");
  const mcpProbeTtlMs = Number.isFinite(mcpProbeTtlMsRaw) && mcpProbeTtlMsRaw > 0 ? Math.floor(mcpProbeTtlMsRaw) : 60_000;
  const agentsTtlMsRaw = Number(process.env.AGENT_WEB_AGENTS_TTL_MS || "");
  const agentsTtlMs = Number.isFinite(agentsTtlMsRaw) && agentsTtlMsRaw > 0 ? Math.floor(agentsTtlMsRaw) : 120_000;
  const mcpAutoRefreshEnabled = process.env.AGENT_WEB_MCP_AUTO_REFRESH !== "0";

  const settingsEnvValue = (
    name: string,
    settings: RuntimeSettings,
    dotenvEnv: Record<string, string>
  ): string => {
    const fromRuntime = String(settings.runtimeEnv?.[name] || "");
    if (hasEffectiveEnvValue(fromRuntime)) return fromRuntime.trim();

    if (Object.prototype.hasOwnProperty.call(dotenvEnv, name)) {
      const fromDotenv = String(dotenvEnv[name] || "");
      return hasEffectiveEnvValue(fromDotenv) ? fromDotenv.trim() : "";
    }

    const fromProcess = String(process.env[name] || "");
    if (hasEffectiveEnvValue(fromProcess)) return fromProcess.trim();
    if (name === "ANTHROPIC_AUTH_TOKEN" && hasEffectiveEnvValue(settings.authToken)) return settings.authToken.trim();
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

  const findActiveWorkspaceQuery = (workspaceId: string): { mcpServerStatus: () => Promise<unknown[]> } | null => {
    let activeQuery: { mcpServerStatus: () => Promise<unknown[]> } | null = null;
    if (!activeQueries) return null;
    for (const [key, value] of activeQueries) {
      if (key.startsWith(`${workspaceId}:`)) activeQuery = value;
    }
    return activeQuery;
  };

  const startMcpProbe = (
    workspaceId: string,
    workspaceRoot?: string,
    settingsForProbe?: RuntimeSettings
  ): { started: boolean; reason: string } => {
    const snapshot = getMcpSnapshot(workspaceId);
    if (snapshot.checking) return { started: false, reason: "already_checking" };

    const runtimeSession = sessionRuntimeManager?.findWorkspaceRuntime(workspaceId) || null;
    let mcpStatusSource = (runtimeSession?.session || findActiveWorkspaceQuery(workspaceId) || null) as
      | { mcpServerStatus?: () => Promise<unknown[]> }
      | null;
    let ephemeralProbeQuery: (ReturnType<typeof query> & { close?: () => void }) | null = null;

    snapshot.checking = true;
    snapshot.error = "";
    snapshot.source = runtimeSession ? "persistent_session" : mcpStatusSource ? "active_session" : "initializing_probe";
    void (async () => {
      try {
        if ((!mcpStatusSource || typeof mcpStatusSource.mcpServerStatus !== "function") && workspaceRoot && settingsForProbe) {
          const probeOptions = buildQueryOptions(workspaceRoot, settingsForProbe, randomUUID(), undefined, {
            includePartialMessages: false
          });
          ephemeralProbeQuery = query({
            prompt: "MCP health probe",
            options: probeOptions
          }) as ReturnType<typeof query> & { close?: () => void };
          mcpStatusSource = ephemeralProbeQuery as unknown as { mcpServerStatus?: () => Promise<unknown[]> };
          snapshot.source = "ephemeral_query";
        }

        if (!mcpStatusSource || typeof mcpStatusSource.mcpServerStatus !== "function") {
          snapshot.ok = null;
          snapshot.error = "No active chat session.";
          snapshot.source = "active_session_missing";
          return;
        }

        // Keep method bound to source object; extracting then calling can break internal state.
        const rawStatus = await withTimeout(mcpStatusSource.mcpServerStatus.call(mcpStatusSource), 180000, "mcpServerStatus");
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
        snapshot.source = runtimeSession ? "persistent_session" : "active_session";
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
        try {
          ephemeralProbeQuery?.close?.();
        } catch {
          // ignore close errors
        }
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
    const dotenvEnv = await readWorkspaceDotenv(workspace.root);
    const configured = await readMcpConfig(workspace.root);
    const requiredEnvKeys = Array.from(new Set(configured.flatMap((item) => item.requiredEnvVars || [])));
    const runtimeEnvView: Record<string, string> = { ...(settings.runtimeEnv || {}) };
    for (const key of requiredEnvKeys) {
      const value = settingsEnvValue(key, settings, dotenvEnv).trim();
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

  app.get("/api/agents", async (req, res) => {
    const workspace = workspaceRegistry.requireWorkspace(req, res);
    if (!workspace) return;
    try {
      const cached = agentsCache.get(workspace.id) || null;
      if (cached && Date.now() - cached.checkedAt < agentsTtlMs) {
        res.json({
          ok: true,
          workspaceId: workspace.id,
          count: cached.items.length,
          source: "claude-agent-sdk-supportedAgents:cache",
          stale: false,
          items: cached.items
        });
        return;
      }
      const projectAgents = await collectProjectAgents(workspace.root);
      if (projectAgents.length === 0) {
        const empty: AgentRow[] = [];
        agentsCache.set(workspace.id, { checkedAt: Date.now(), items: empty });
        res.json({
          ok: true,
          workspaceId: workspace.id,
          count: 0,
          source: "workspace-.claude-agents",
          stale: false,
          items: empty
        });
        return;
      }
      const settings = await readSettings(workspace.root, defaultSettings);
      const options = buildQueryOptions(workspace.root, settings, randomUUID(), undefined, {
        includePartialMessages: false
      });
      const q = query({
        prompt: "List supported agents",
        options
      }) as ReturnType<typeof query> & { close?: () => void; supportedAgents?: () => Promise<unknown[]> };
      try {
        const raw =
          typeof q.supportedAgents === "function" ? await withTimeout(q.supportedAgents(), 20_000, "supportedAgents") : [];
        const supportedItems = (Array.isArray(raw) ? raw : [])
          .map((row) => {
            const rowValue: unknown = row;
            if (typeof rowValue === "string") {
              const name = rowValue.trim();
              if (!name) return null;
              return { name, description: "", model: "" };
            }
            if (!rowValue || typeof rowValue !== "object") return null;
            const item = rowValue as Record<string, unknown>;
            const name = String(item.name || item.agent || item.id || "").trim();
            if (!name) return null;
            return { name, description: String(item.description || "").trim(), model: String(item.model || "").trim() };
          })
          .filter((x): x is AgentRow => Boolean(x));
        const supportedMap = new Map<string, AgentRow>();
        for (const item of supportedItems) {
          supportedMap.set(item.name.trim().toLowerCase(), item);
        }
        const items = projectAgents.map((item) => {
          const matched = supportedMap.get(item.name.trim().toLowerCase());
          if (!matched) return item;
          return {
            name: item.name,
            description: item.description || matched.description || "",
            model: matched.model || ""
          };
        });
        agentsCache.set(workspace.id, { checkedAt: Date.now(), items });
        res.json({
          ok: true,
          workspaceId: workspace.id,
          count: items.length,
          source: "workspace-.claude-agents+sdk-enriched",
          stale: false,
          items
        });
      } finally {
        try {
          q.close?.();
        } catch {
          // ignore close errors
        }
      }
    } catch (error) {
      const cached = agentsCache.get(workspace.id) || null;
      const msg = error instanceof Error ? error.message : "Unknown error";
      if (cached) {
        res.json({
          ok: true,
          workspaceId: workspace.id,
          count: cached.items.length,
          source: "claude-agent-sdk-supportedAgents:cache-fallback",
          stale: true,
          warning: msg,
          items: cached.items
        });
        return;
      }
      const projectAgents = await collectProjectAgents(workspace.root);
      if (projectAgents.length > 0) {
        agentsCache.set(workspace.id, { checkedAt: Date.now(), items: projectAgents });
        res.json({
          ok: true,
          workspaceId: workspace.id,
          count: projectAgents.length,
          source: "workspace-.claude-agents:fallback",
          stale: true,
          warning: msg,
          items: projectAgents
        });
        return;
      }
      res.status(500).json({ ok: false, error: msg, items: [] });
    }
  });

  app.get("/api/mcps", async (req, res) => {
    try {
      const workspace = workspaceRegistry.requireWorkspace(req, res);
      if (!workspace) return;
      const settings = await readSettings(workspace.root, defaultSettings);
      const dotenvEnv = await readWorkspaceDotenv(workspace.root);
      const configured = await readMcpConfig(workspace.root);
      const snapshot = getMcpSnapshot(workspace.id);
      const now = Date.now();
      const ageSeconds = snapshot.checkedAt > 0 ? Math.max(0, Math.floor((now - snapshot.checkedAt) / 1000)) : null;
      const stale = ageSeconds !== null ? now - snapshot.checkedAt > mcpProbeTtlMs : true;
      const refreshRaw = typeof req.query?.refresh === "string" ? req.query.refresh.trim().toLowerCase() : "";
      const forceRefresh = refreshRaw === "1" || refreshRaw === "true";
      let refreshResult: { started: boolean; reason: string } | null = null;
      let autoRefreshTriggered = false;
      if (forceRefresh && settings.mcpEnabled && configured.length > 0) {
        refreshResult = startMcpProbe(workspace.id, workspace.root, settings);
        autoRefreshTriggered = true;
      } else if (forceRefresh && !settings.mcpEnabled) {
        refreshResult = { started: false, reason: "mcp_disabled" };
      } else if (forceRefresh && configured.length === 0) {
        refreshResult = { started: false, reason: "config_empty" };
      } else if (!forceRefresh && mcpAutoRefreshEnabled && stale && settings.mcpEnabled && configured.length > 0 && !snapshot.checking) {
        refreshResult = startMcpProbe(workspace.id, workspace.root, settings);
        autoRefreshTriggered = true;
      }
      const effectiveSnapshot = forceRefresh || autoRefreshTriggered ? getMcpSnapshot(workspace.id) : snapshot;

      const items = configured.map((item) => {
        const runtime = effectiveSnapshot.rows.get(item.name) || null;
        const missingEnvVars = item.requiredEnvVars.filter((name) => {
          return !settingsEnvValue(name, settings, dotenvEnv).trim();
        });
        const defaultRuntime =
          settings.mcpEnabled === false
            ? { connected: null, status: "disabled", error: "" }
            : missingEnvVars.length > 0
              ? { connected: false, status: "missing_env", error: `Missing env: ${missingEnvVars.join(", ")}` }
              : effectiveSnapshot.checking
                ? { connected: null, status: "checking", error: "" }
                : effectiveSnapshot.ok === false
                  ? { connected: null, status: "probe_failed", error: effectiveSnapshot.error }
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
          ok: effectiveSnapshot.ok,
          error: effectiveSnapshot.error,
          source: effectiveSnapshot.source,
          checking: effectiveSnapshot.checking,
          lastCheckedAt: effectiveSnapshot.checkedAt || null,
          ageSeconds,
          stale
        },
        refresh: refreshResult,
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

      const result = startMcpProbe(workspace.id, workspace.root, settings);
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

  app.get("/api/files/search", async (req, res) => {
    try {
      const workspace = workspaceRegistry.requireWorkspace(req, res);
      if (!workspace) return;
      const q = typeof req.query?.q === "string" ? req.query.q.trim() : "";
      const limitRaw = Number(req.query?.limit ?? 60);
      const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), 1), 100) : 60;
      if (!q) {
        res.json({ ok: true, workspaceId: workspace.id, q: "", count: 0, items: [] });
        return;
      }

      const rules = await loadIgnoreRules(workspace.root);
      const items = await searchWorkspaceFilesByName(workspace.root, q, rules, limit);
      res.json({
        ok: true,
        workspaceId: workspace.id,
        q,
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

  app.delete("/api/sessions/:sessionId", async (req, res) => {
    try {
      const workspace = workspaceRegistry.requireWorkspace(req, res);
      if (!workspace) return;
      const sessionId = typeof req.params?.sessionId === "string" ? req.params.sessionId : "";
      if (!sessionId) {
        res.status(400).json({ ok: false, error: "sessionId is required" });
        return;
      }
      const deleted = await deleteSession(workspace.root, sessionId);
      res.json({ ok: true, workspaceId: workspace.id, sessionId, deleted });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "unknown error";
      res.status(500).json({ ok: false, error: msg });
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
      const parsedRuntimeEnv = parseEnvText(runtimeEnvTextRaw);
      for (const [key, value] of Object.entries(parsedRuntimeEnv)) {
        if (!hasEffectiveEnvValue(value)) continue;
        nextRuntimeEnv[key] = String(value).trim();
      }
    } else {
      Object.assign(nextRuntimeEnv, current.runtimeEnv || {});
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
    invalidateSkillsCache(workspace.root);
    clearSlashNamesCache(workspace.root);
    const closedRuntimeSessions = sessionRuntimeManager ? sessionRuntimeManager.closeWorkspace(workspace.id) : 0;
    let mcpRefresh: { started: boolean; reason: string } | null = null;
    const snapshot = getMcpSnapshot(workspace.id);
    if (!next.mcpEnabled) {
      snapshot.ok = null;
      snapshot.error = "";
      snapshot.source = "disabled";
      snapshot.checking = false;
      snapshot.checkedAt = Date.now();
      snapshot.rows.clear();
      mcpRefresh = { started: false, reason: "mcp_disabled" };
    } else {
      const configured = await readMcpConfig(workspace.root);
      if (configured.length > 0) {
        mcpRefresh = startMcpProbe(workspace.id, workspace.root, next);
      } else {
        snapshot.ok = null;
        snapshot.error = "";
        snapshot.source = "config_empty";
        snapshot.checking = false;
        snapshot.checkedAt = Date.now();
        snapshot.rows.clear();
        mcpRefresh = { started: false, reason: "config_empty" };
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
      closedRuntimeSessions,
      mcpRefresh,
      dotenvSync: { synced: true }
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
