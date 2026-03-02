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
    trackAgentUsage,
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
      phase: prev.phase === "streaming_text" ? prev.phase : "responding",
      phaseDetail: prev.phaseDetail || "正在生成可见回复",
      phaseStartedAt: prev.phase === "streaming_text" ? prev.phaseStartedAt : now,
      phaseEtaSeconds: prev.phase === "streaming_text" ? prev.phaseEtaSeconds : 2,
      lastActivityAt: now,
      lastDeltaAt: now,
      dismissNoDelta: false
    }));
    return "handled";
  }

  if (part?.type === "data-runtime-phase") {
    const nextPhase = String(part?.data?.phase || "queued");
    const detail = String(part?.data?.detail || "");
    const etaRaw = Number(part?.data?.etaSeconds);
    setExecutionState((prev) => {
      const phaseChanged = prev.phase !== nextPhase;
      const nextActions = detail ? [...(prev.actions || []).slice(-4), detail] : prev.actions || [];
      return {
        ...prev,
        phase: nextPhase,
        phaseDetail: detail || prev.phaseDetail || "",
        phaseStartedAt: phaseChanged ? now : prev.phaseStartedAt || now,
        phaseEtaSeconds: Number.isFinite(etaRaw) && etaRaw >= 0 ? Math.floor(etaRaw) : prev.phaseEtaSeconds ?? null,
        lastActivityAt: now,
        actions: nextActions,
        dismissNoDelta: false
      };
    });
    return "handled";
  }

  if (part?.type === "data-runtime-activity") {
    const detail = String(part?.data?.detail || "").trim();
    if (detail) {
      setExecutionState((prev) => ({
        ...prev,
        lastActivityAt: now,
        actions: [...(prev.actions || []).slice(-4), detail],
        dismissNoDelta: false
      }));
    } else {
      setExecutionState((prev) => ({ ...prev, lastActivityAt: now }));
    }
    return "handled";
  }

  if (part?.type === "data-agent-activity") {
    const agentType = String(part?.data?.agentType || "").trim();
    const agentId = String(part?.data?.agentId || "").trim();
    const status = String(part?.data?.status || "").trim();
    const label = agentType || agentId || "agent";
    const actionText = status === "stop" ? `子代理完成：${label}` : `子代理启动：${label}`;
    if (typeof trackAgentUsage === "function") {
      trackAgentUsage(label, status || "start");
    }
    setExecutionState((prev) => ({
      ...prev,
      currentAgent: status === "stop" ? "" : label,
      phase: status === "stop" ? prev.phase : "running_tool",
      phaseDetail: status === "stop" ? prev.phaseDetail : `子代理执行中：${label}`,
      lastActivityAt: now,
      actions: [...(prev.actions || []).slice(-4), actionText],
      dismissNoDelta: false
    }));
    return "handled";
  }

  if (part?.type === "data-runtime-heartbeat") {
    setExecutionState((prev) => ({
      ...prev,
      phase: String(part?.data?.phase || prev.phase || "queued"),
      lastActivityAt: now
    }));
    return "handled";
  }

  if (part?.type === "data-runtime-warning") {
    const warningText = "等待工具/上游返回";
    setExecutionState((prev) => ({
      ...prev,
      phase: prev.phase === "error" ? "error" : "waiting_model",
      lastActivityAt: now,
      warnings: [...(prev.warnings || []).slice(-2), warningText],
      actions: [...(prev.actions || []).slice(-4), warningText],
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
      phaseDetail: String(part?.data?.toolName || ""),
      phaseStartedAt: prev.phase === "tool" ? prev.phaseStartedAt : now,
      phaseEtaSeconds: 20,
      lastActivityAt: now,
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
      phaseDetail: "工具执行完成，正在汇总结果",
      phaseEtaSeconds: 8,
      lastActivityAt: now,
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
      phaseDetail: "长时间未产生文本，仍在执行中",
      phaseEtaSeconds: null,
      lastActivityAt: now,
      actions: [...(prev.actions || []).slice(-4), "等待工具/上游返回"],
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
    setExecutionState((prev) => ({
      ...prev,
      phase: "running_tool",
      phaseDetail: `正在调用 ${String(part?.data?.toolName || "tool")}`,
      phaseStartedAt: prev.phase === "running_tool" ? prev.phaseStartedAt : now,
      phaseEtaSeconds: 20,
      lastActivityAt: now,
      currentTool: String(part?.data?.toolName || prev.currentTool || ""),
      currentAgent: prev.currentAgent || "",
      actions: [...(prev.actions || []).slice(-4), `工具调用：${String(part?.data?.toolName || "unknown_tool")}`],
      dismissNoDelta: false
    }));
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
      phaseDetail: "等待权限确认",
      lastActivityAt: now,
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
      phaseDetail: "请求执行失败",
      lastActivityAt: now,
      currentAgent: "",
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
