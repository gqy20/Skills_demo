import { useCallback, useMemo, useState } from "react";
import { parseMcpToolName } from "../lib/chatUtils.js";

export const INITIAL_RUNTIME_USAGE = { skills: {}, mcps: {} };

export function addSkillUsage(prev, skillName, details = null) {
  const name = String(skillName || "").trim().toLowerCase();
  if (!name) return prev;
  const old = prev.skills[name] || { count: 0, lastTs: 0, details: null };
  return {
    ...prev,
    skills: {
      ...prev.skills,
      [name]: { count: old.count + 1, lastTs: Date.now(), details: details || old.details || null }
    }
  };
}

export function addMcpUsage(prev, toolName, elapsedSeconds = null) {
  const parsed = parseMcpToolName(toolName);
  if (!parsed) return prev;
  const key = `${parsed.server}:${parsed.tool}`;
  const old = prev.mcps[key] || { count: 0, lastTs: 0, details: null };
  return {
    ...prev,
    mcps: {
      ...prev.mcps,
      [key]: {
        count: old.count + 1,
        lastTs: Date.now(),
        details: { server: parsed.server, tool: parsed.tool, raw: parsed.raw, elapsedSeconds }
      }
    }
  };
}

export function useRuntimeUsage() {
  const [runtimeUsage, setRuntimeUsage] = useState(INITIAL_RUNTIME_USAGE);
  const [usagePanelOpen, setUsagePanelOpen] = useState(false);
  const [usageExpanded, setUsageExpanded] = useState({ skills: false, mcps: false });

  const trackSkillUsage = useCallback((skillName, details = null) => {
    setRuntimeUsage((prev) => addSkillUsage(prev, skillName, details));
  }, []);

  const trackMcpUsage = useCallback((toolName, elapsedSeconds = null) => {
    const parsed = parseMcpToolName(toolName);
    if (!parsed) return false;
    setRuntimeUsage((prev) => addMcpUsage(prev, toolName, elapsedSeconds));
    return true;
  }, []);

  const resetRuntimeUsage = useCallback(() => {
    setRuntimeUsage(INITIAL_RUNTIME_USAGE);
    setUsagePanelOpen(false);
    setUsageExpanded({ skills: false, mcps: false });
  }, []);

  const startTurnUsage = useCallback((initialSkillsState = {}) => {
    setRuntimeUsage({ skills: { ...(initialSkillsState || {}) }, mcps: {} });
    setUsagePanelOpen(false);
    setUsageExpanded({ skills: false, mcps: false });
  }, []);

  const skillUsageList = useMemo(
    () =>
      Object.entries(runtimeUsage.skills)
        .map(([name, item]) => ({ name, ...(item || {}) }))
        .sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0)),
    [runtimeUsage.skills]
  );

  const mcpUsageList = useMemo(
    () =>
      Object.entries(runtimeUsage.mcps)
        .map(([key, item]) => ({ key, ...(item || {}) }))
        .sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0)),
    [runtimeUsage.mcps]
  );

  return {
    usagePanelOpen,
    usageExpanded,
    setUsagePanelOpen,
    setUsageExpanded,
    trackSkillUsage,
    trackMcpUsage,
    resetRuntimeUsage,
    startTurnUsage,
    skillUsageList,
    mcpUsageList
  };
}
