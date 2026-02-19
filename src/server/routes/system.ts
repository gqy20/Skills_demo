import type { Express } from "express";
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

type SystemRoutesDeps = {
  app: Express;
  workspaceRegistry: WorkspaceRegistry;
  defaultSettings: RuntimeSettings;
};

export function registerSystemRoutes({ app, workspaceRegistry, defaultSettings }: SystemRoutesDeps): void {
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
    res.json({
      workspaceId: workspace.id,
      workspaceRoot: workspace.root,
      model: settings.model,
      baseUrl: settings.baseUrl,
      permissionProfile: settings.permissionProfile,
      mcpEnabled: settings.mcpEnabled,
      speedModeEnabled: settings.speedModeEnabled,
      toolGateEnabled: settings.toolGateEnabled,
      debugEnabled: settings.debugEnabled,
      debugSseEnabled: settings.debugSseEnabled,
      hasToken: Boolean(settings.authToken),
      tokenPreview: maskToken(settings.authToken),
      hasMineruKey: Boolean(settings.mineruApiKey),
      mineruKeyPreview: maskToken(settings.mineruApiKey)
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
    const mineruKeyInput = typeof req.body?.mineruApiKey === "string" ? req.body.mineruApiKey.trim() : "";
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
    const keepExistingMineruKey = req.body?.keepExistingMineruKey !== false;

    const next: RuntimeSettings = {
      model: model || current.model,
      baseUrl: baseUrl || current.baseUrl,
      authToken: tokenInput ? tokenInput : keepExistingToken ? current.authToken : "",
      mineruApiKey: mineruKeyInput ? mineruKeyInput : keepExistingMineruKey ? current.mineruApiKey : "",
      permissionProfile,
      mcpEnabled,
      speedModeEnabled,
      toolGateEnabled,
      debugEnabled,
      debugSseEnabled
    };

    await writeSettings(workspace.root, next);
    res.json({
      ok: true,
      workspaceId: workspace.id,
      workspaceRoot: workspace.root,
      model: next.model,
      baseUrl: next.baseUrl,
      permissionProfile: next.permissionProfile,
      mcpEnabled: next.mcpEnabled,
      speedModeEnabled: next.speedModeEnabled,
      toolGateEnabled: next.toolGateEnabled,
      debugEnabled: next.debugEnabled,
      debugSseEnabled: next.debugSseEnabled,
      hasToken: Boolean(next.authToken),
      tokenPreview: maskToken(next.authToken),
      hasMineruKey: Boolean(next.mineruApiKey),
      mineruKeyPreview: maskToken(next.mineruApiKey)
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
