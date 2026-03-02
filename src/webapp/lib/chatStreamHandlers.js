const MAX_EVENT_LOG = 120;
const MAX_HOOK_TIMELINE = 80;

function appendEvent(setEvents, part) {
  setEvents((prev) => [...prev.slice(-(MAX_EVENT_LOG - 1)), part]);
}

function appendHookStage(setHookTimeline, now, data) {
  if (typeof setHookTimeline !== "function") return;
  const at = Number(data?.at || now || Date.now());
  const item = {
    stage: String(data?.stage || "unknown"),
    at,
    source: String(data?.source || "sdk"),
    hookName: String(data?.hookName || ""),
    hookEvent: String(data?.hookEvent || ""),
    hookId: String(data?.hookId || ""),
    toolName: String(data?.toolName || ""),
    toolUseId: String(data?.toolUseId || ""),
    outcome: String(data?.outcome || ""),
    detail: String(data?.detail || ""),
    resultSubtype: String(data?.resultSubtype || ""),
    isError: data?.isError === true,
    stopReason: data?.stopReason ? String(data.stopReason) : ""
  };
  setHookTimeline((prev) => {
    const list = Array.isArray(prev) ? [...prev] : [];
    const last = list[list.length - 1];
    const shouldCoalesce =
      last &&
      last.stage === item.stage &&
      (item.stage === "responding" || item.stage === "tool_progress" || item.stage === "hook_progress");
    if (shouldCoalesce) {
      list[list.length - 1] = { ...last, ...item };
      return list.slice(-MAX_HOOK_TIMELINE);
    }
    return [...list.slice(-(MAX_HOOK_TIMELINE - 1)), item];
  });
}

export function handleChatStreamPart(part, deps) {
  const {
    setEvents,
    now,
    setCurrentSessionId,
    setActiveTurnTrace,
    loadSessions,
    loadMcps,
    setMcpRuntimeStatus,
    setExecutionState,
    trackMcpUsage,
    setDiagnostics,
    upsertPending,
    resolvePending,
    trackSkillUsage,
    toolLabel,
    shortText,
    setHookTimeline
  } = deps;

  appendEvent(setEvents, part);

  if (part?.type === "data-session" && part?.data?.sessionId) {
    setCurrentSessionId((prev) => (prev === part.data.sessionId ? prev : part.data.sessionId));
    return "handled";
  }

  if (part?.type === "finish") {
    appendHookStage(setHookTimeline, now, { stage: "completed", source: "ui" });
    setActiveTurnTrace((prev) =>
      prev
        ? {
            ...prev,
            completedAt: Date.now(),
            phases: [...(prev.phases || []), { phase: "completed", at: Date.now() }].slice(-30)
          }
        : prev
    );
    loadSessions().catch(() => {});
    return "handled";
  }

  if (part?.type === "data-mcp-status") {
    const rawError = String(part?.data?.error || "");
    const isTimeout = /timed out/i.test(rawError);
    setMcpRuntimeStatus({
      ok: part?.data?.ok === true,
      count: Number(part?.data?.count || 0),
      error: rawError,
      status: isTimeout ? "timeout" : part?.data?.ok === true ? "ok" : rawError ? "error" : "unknown"
    });
    if (typeof loadMcps === "function") loadMcps().catch(() => {});
    return "handled";
  }

  if (part?.type === "text-delta") {
    appendHookStage(setHookTimeline, now, { stage: "responding", source: "sdk" });
    setActiveTurnTrace((prev) => {
      if (!prev || prev.responseStarted) return prev;
      return {
        ...prev,
        responseStarted: true,
        phases: [...(prev.phases || []), { phase: "responding", at: now }].slice(-30)
      };
    });
    setExecutionState((prev) => ({
      ...prev,
      phase: "responding",
      lastDeltaAt: now,
      dismissNoDelta: false
    }));
    return "handled";
  }

  if (part?.type === "data-tool-progress") {
    trackMcpUsage(part?.data?.toolName, part?.data?.elapsedSeconds ?? null);
    setActiveTurnTrace((prev) => {
      if (!prev) return prev;
      const label = toolLabel(part?.data?.toolName);
      const useId = String(part?.data?.toolUseId || "");
      const seen = { ...(prev.seenToolUseIds || {}) };
      const tools = { ...(prev.tools || {}) };
      const old = tools[label] || { count: 0, elapsedSeconds: 0 };
      const isNewUse = useId ? seen[useId] !== true : old.count === 0;
      if (useId) seen[useId] = true;
      tools[label] = {
        count: isNewUse ? old.count + 1 : old.count,
        elapsedSeconds: Math.max(old.elapsedSeconds || 0, Number(part?.data?.elapsedSeconds || 0))
      };
      const phases =
        prev.lastToolLabel === label
          ? prev.phases || []
          : [...(prev.phases || []), { phase: "tool_running", at: now, detail: label }].slice(-30);
      return { ...prev, seenToolUseIds: seen, tools, lastToolLabel: label, phases };
    });
    setExecutionState((prev) => ({
      ...prev,
      phase: "tool",
      currentTool: String(part?.data?.toolName || prev.currentTool || ""),
      toolElapsedSeconds:
        typeof part?.data?.elapsedSeconds === "number" && Number.isFinite(part?.data?.elapsedSeconds)
          ? Math.max(0, part.data.elapsedSeconds)
          : prev.toolElapsedSeconds,
      dismissNoDelta: false
    }));
    return "handled";
  }

  if (part?.type === "data-tool-use-summary") {
    const summary = String(part?.data?.summary || "");
    const matched = summary.match(/\/([a-zA-Z0-9_-]+)/g) || [];
    for (const token of matched) {
      trackSkillUsage(token.replace("/", ""), { source: "summary", summary: shortText(summary, 280) });
    }
    setActiveTurnTrace((prev) => {
      if (!prev) return prev;
      const nextAction = shortText(summary, 220);
      const skills = { ...(prev.skills || {}) };
      for (const token of matched) {
        const name = token.replace("/", "").trim().toLowerCase();
        if (!name) continue;
        const old = skills[name] || { count: 0 };
        skills[name] = { count: old.count + 1 };
      }
      return {
        ...prev,
        skills,
        actions: [...(prev.actions || []).slice(-5), nextAction],
        phases: [...(prev.phases || []), { phase: "tool_summary", at: now }].slice(-30)
      };
    });
    setExecutionState((prev) => ({
      ...prev,
      phase: "tool",
      actions: [...prev.actions.slice(-4), shortText(summary, 220)],
      dismissNoDelta: false
    }));
    return "handled";
  }

  if (part?.type === "data-hook-stage") {
    appendHookStage(setHookTimeline, now, part?.data || {});
    return "handled";
  }

  if (part?.type === "data-first-token-timeout") {
    appendHookStage(setHookTimeline, now, {
      stage: "first_text_timeout",
      source: "sdk",
      detail: `waited=${Number(part?.data?.waitedSeconds || 0)}s`
    });
    setExecutionState((prev) => ({
      ...prev,
      phase: "waiting_model",
      actions: [...(prev.actions || []).slice(-4), "上游长时间未返回文本，建议继续等待或重试。"],
      dismissNoDelta: false
    }));
    return "handled";
  }

  if (part?.type === "data-tool-gate-status") {
    setDiagnostics((prev) => ({
      ...prev,
      toolGateEnabled: part?.data?.enabled !== false
    }));
    return "handled";
  }

  if (part?.type === "data-tool-gate-hit") {
    trackMcpUsage(part?.data?.toolName, null);
    setActiveTurnTrace((prev) => {
      if (!prev) return prev;
      const label = toolLabel(part?.data?.toolName);
      const tools = { ...(prev.tools || {}) };
      const old = tools[label] || { count: 0, elapsedSeconds: 0 };
      tools[label] = { ...old, count: old.count + 1 };
      return { ...prev, tools };
    });
    setDiagnostics((prev) => ({ ...prev, gateHits: prev.gateHits + 1 }));
    return "handled";
  }

  if (part?.type === "data-ask-user-question-created") {
    appendHookStage(setHookTimeline, now, { stage: "waiting_user_input", source: "ui" });
    setDiagnostics((prev) => ({ ...prev, askCreated: prev.askCreated + 1 }));
    upsertPending("ask_user_question", part.data || {});
    setExecutionState((prev) => ({ ...prev, phase: "pending", dismissNoDelta: false }));
    setActiveTurnTrace((prev) =>
      prev ? { ...prev, phases: [...(prev.phases || []), { phase: "waiting_user_input", at: now }].slice(-30) } : prev
    );
    return "handled";
  }

  if (part?.type === "data-permission-request-created") {
    appendHookStage(setHookTimeline, now, {
      stage: "waiting_permission",
      source: "ui",
      toolName: String(part?.data?.toolName || "")
    });
    trackMcpUsage(part?.data?.toolName, null);
    setActiveTurnTrace((prev) => {
      if (!prev) return prev;
      const label = toolLabel(part?.data?.toolName);
      const tools = { ...(prev.tools || {}) };
      const old = tools[label] || { count: 0, elapsedSeconds: 0 };
      tools[label] = { ...old, count: old.count + 1 };
      return { ...prev, tools };
    });
    upsertPending("permission_request", part.data || {});
    setExecutionState((prev) => ({
      ...prev,
      phase: "pending",
      currentTool: String(part?.data?.toolName || prev.currentTool || ""),
      dismissNoDelta: false
    }));
    setActiveTurnTrace((prev) =>
      prev
        ? {
            ...prev,
            phases: [
              ...(prev.phases || []),
              { phase: "waiting_permission", at: now, detail: toolLabel(part?.data?.toolName) }
            ].slice(-30)
          }
        : prev
    );
    return "handled";
  }

  if (
    part?.type === "data-ask-user-question-resolved" ||
    part?.type === "data-ask-user-question-timeout" ||
    part?.type === "data-ask-user-question-canceled"
  ) {
    setDiagnostics((prev) => ({ ...prev, askResolved: prev.askResolved + 1 }));
    resolvePending(part.data || {});
    return "handled";
  }

  if (
    part?.type === "data-permission-request-resolved" ||
    part?.type === "data-permission-request-timeout" ||
    part?.type === "data-permission-request-canceled"
  ) {
    resolvePending(part.data || {});
    return "handled";
  }

  if (part?.type === "error") {
    appendHookStage(setHookTimeline, now, {
      stage: "result",
      source: "sdk",
      outcome: "error",
      detail: String(part?.error || "")
    });
    setExecutionState((prev) => ({
      ...prev,
      phase: "error",
      actions: [...(prev.actions || []).slice(-4), String(part?.error || "未知错误")],
      dismissNoDelta: false
    }));
    return "handled";
  }

  return "ignored";
}

export function handleChatStreamError(error, deps) {
  const { setEvents, parseError } = deps;
  appendEvent(setEvents, { type: "error", error: parseError(error) });
}
