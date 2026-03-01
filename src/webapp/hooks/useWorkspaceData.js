import { useCallback } from "react";
import { normalizeSettings, parseEnvText, parseError } from "../lib/chatUtils.js";

export function normalizeMcpCatalogResponse(data, now = Date.now()) {
  return {
    loading: false,
    error: "",
    mcpEnabled: data?.mcpEnabled !== false,
    runtime: {
      ok: typeof data?.runtime?.ok === "boolean" ? data.runtime.ok : null,
      error: String(data?.runtime?.error || ""),
      source: String(data?.runtime?.source || ""),
      checking: data?.runtime?.checking === true,
      lastCheckedAt: typeof data?.runtime?.lastCheckedAt === "number" ? data.runtime.lastCheckedAt : null,
      ageSeconds: typeof data?.runtime?.ageSeconds === "number" ? data.runtime.ageSeconds : null,
      stale: data?.runtime?.stale !== false
    },
    items: Array.isArray(data?.items) ? data.items : [],
    updatedAt: now
  };
}

export function useWorkspaceData({
  currentWorkspaceId,
  apiGetJson,
  apiPostJson,
  setWorkspaces,
  setCurrentWorkspaceId,
  setSettings,
  setDiagnostics,
  setSkills,
  setFiles,
  setMcpCatalog,
  setSessions,
  setSessionsLoading,
  setSessionsError,
  setCurrentSessionId
}) {
  const loadWorkspaces = useCallback(async () => {
    const data = await apiGetJson("/api/workspaces", { workspaceId: "" });
    const items = Array.isArray(data.items) ? data.items : [];
    setWorkspaces(items);
    setCurrentWorkspaceId((prev) => prev || data.currentWorkspaceId || items[0]?.id || "");
  }, [apiGetJson, setCurrentWorkspaceId, setWorkspaces]);

  const loadSettings = useCallback(async () => {
    if (!currentWorkspaceId) return;
    const data = await apiGetJson("/api/settings");
    setSettings(normalizeSettings(data));
    setDiagnostics((prev) => ({ ...prev, toolGateEnabled: data.toolGateEnabled !== false }));
  }, [apiGetJson, currentWorkspaceId, setDiagnostics, setSettings]);

  const loadSkills = useCallback(async () => {
    if (!currentWorkspaceId) return;
    const data = await apiGetJson("/api/skills");
    setSkills(Array.isArray(data.items) ? data.items : []);
  }, [apiGetJson, currentWorkspaceId, setSkills]);

  const loadFiles = useCallback(async () => {
    if (!currentWorkspaceId) return;
    const data = await apiGetJson("/api/files", { depth: 2, path: "" });
    setFiles(Array.isArray(data.items) ? data.items : []);
  }, [apiGetJson, currentWorkspaceId, setFiles]);

  const loadMcps = useCallback(async () => {
    if (!currentWorkspaceId) return;
    setMcpCatalog((prev) => ({ ...prev, loading: true, error: "" }));
    try {
      const data = await apiGetJson("/api/mcps");
      setMcpCatalog(normalizeMcpCatalogResponse(data));
    } catch (error) {
      setMcpCatalog((prev) => ({ ...prev, loading: false, error: parseError(error), updatedAt: Date.now() }));
    }
  }, [apiGetJson, currentWorkspaceId, setMcpCatalog]);

  const refreshMcps = useCallback(async () => {
    if (!currentWorkspaceId) return;
    setMcpCatalog((prev) => ({ ...prev, loading: true, error: "" }));
    try {
      await apiPostJson("/api/mcps/refresh", {});
    } catch (error) {
      setMcpCatalog((prev) => ({ ...prev, loading: false, error: parseError(error), updatedAt: Date.now() }));
      return;
    }
    const delays = [0, 400, 1200, 2600];
    for (let i = 0; i < delays.length; i += 1) {
      if (delays[i] > 0) await new Promise((resolve) => setTimeout(resolve, delays[i]));
      await loadMcps();
    }
  }, [apiPostJson, currentWorkspaceId, loadMcps, setMcpCatalog]);

  const loadSessions = useCallback(async () => {
    if (!currentWorkspaceId) return;
    setSessionsLoading(true);
    setSessionsError("");
    try {
      const data = await apiGetJson("/api/sessions");
      setSessions(Array.isArray(data.items) ? data.items : []);
    } catch (error) {
      setSessionsError(parseError(error));
    } finally {
      setSessionsLoading(false);
    }
  }, [apiGetJson, currentWorkspaceId, setSessions, setSessionsError, setSessionsLoading]);

  const loadFileSuggestions = useCallback(
    async (rawQuery) => {
      if (!currentWorkspaceId) return [];
      const query = String(rawQuery || "")
        .trim()
        .replaceAll("\\", "/")
        .replace(/^\/+/, "");
      const slash = query.lastIndexOf("/");
      const basePath = slash >= 0 ? query.slice(0, slash + 1).replace(/\/+$/, "") : "";
      const depth = basePath ? 2 : 3;
      const data = await apiGetJson("/api/files", { path: basePath, depth });
      return Array.isArray(data?.items) ? data.items : [];
    },
    [apiGetJson, currentWorkspaceId]
  );

  const saveSettings = useCallback(
    async (next) => {
      const data = await apiPostJson("/api/settings", {
        ...next,
        mcpEnvText: next.mcpEnvText,
        mcpEnvUpdates: parseEnvText(next.mcpEnvText),
        keepExistingToken: next.authToken ? false : true,
        keepExistingMineruKey: next.mineruApiKey ? false : true
      });
      setSettings(normalizeSettings(data));
      setCurrentSessionId(null);
      setDiagnostics((prev) => ({ ...prev, toolGateEnabled: data.toolGateEnabled !== false }));
      return data;
    },
    [apiPostJson, setCurrentSessionId, setDiagnostics, setSettings]
  );

  const syncSettingsToDotenv = useCallback(
    async (confirmText) => {
      if (!currentWorkspaceId) return null;
      return apiPostJson("/api/settings/sync-dotenv", { confirmText: String(confirmText || "") });
    },
    [apiPostJson, currentWorkspaceId]
  );

  return {
    loadWorkspaces,
    loadSettings,
    loadSkills,
    loadFiles,
    loadMcps,
    refreshMcps,
    loadSessions,
    loadFileSuggestions,
    saveSettings,
    syncSettingsToDotenv
  };
}
