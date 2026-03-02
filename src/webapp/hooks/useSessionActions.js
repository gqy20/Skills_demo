import { useCallback } from "react";

export function buildTraceMapFromMessages(messages) {
  const loadedTraceMap = {};
  for (const msg of Array.isArray(messages) ? messages : []) {
    if (msg?.role !== "assistant" || !msg?.id) continue;
    const trace = msg?.toolTrace;
    if (!trace || typeof trace !== "object") continue;
    loadedTraceMap[msg.id] = {
      startedAt: Number(trace.startedAt || 0),
      completedAt: Number(trace.completedAt || 0),
      skills: typeof trace.skills === "object" && trace.skills ? trace.skills : {},
      tools: typeof trace.tools === "object" && trace.tools ? trace.tools : {},
      phases: Array.isArray(trace.phases) ? trace.phases : [],
      actions: Array.isArray(trace.actions) ? trace.actions : []
    };
  }
  return loadedTraceMap;
}

export function findLastUserTextFromMessages(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const msg = list[i];
    if (msg?.role !== "user" || !Array.isArray(msg?.parts)) continue;
    const txt = msg.parts
      .filter((p) => p?.type === "text")
      .map((p) => p.text || "")
      .join("")
      .trim();
    if (txt) return txt;
  }
  return "";
}

export function useSessionActions({
  apiGetJson,
  isStreaming,
  blockingPending,
  setOpeningSessionId,
  setMessages,
  setTraceByAssistantId,
  setCurrentSessionId,
  setActiveTurnTrace,
  resetPending,
  setEvents,
  setExecutionState,
  setMcpRuntimeStatus,
  setAgentUsage,
  setLastUserText,
  resetRuntimeUsage,
  setHookTimeline
}) {
  const openSession = useCallback(
    async (sessionId) => {
      if (!sessionId || isStreaming || blockingPending) return;
      setOpeningSessionId(sessionId);
      try {
        const data = await apiGetJson(`/api/sessions/${encodeURIComponent(sessionId)}`);
        const nextMessages = Array.isArray(data?.messages) ? data.messages : [];
        setMessages(nextMessages);
        setTraceByAssistantId(buildTraceMapFromMessages(nextMessages));
        setCurrentSessionId(sessionId);
        setActiveTurnTrace(null);
        resetPending();
        setEvents([]);
        setHookTimeline([]);
        if (typeof setAgentUsage === "function") setAgentUsage({});
        setExecutionState({
          phase: "idle",
          phaseDetail: "",
          phaseStartedAt: 0,
          phaseEtaSeconds: null,
          lastActivityAt: 0,
          currentAgent: "",
          currentTool: "",
          toolElapsedSeconds: 0,
          lastDeltaAt: 0,
          taskRuntime: { tasks: {}, running: 0, completed: 0, failed: 0, stopped: 0, parallelPeak: 0 },
          actions: [],
          dismissNoDelta: false
        });
        setMcpRuntimeStatus({ ok: null, count: 0, error: "", status: "unknown" });
        const last = findLastUserTextFromMessages(nextMessages);
        if (last) setLastUserText(last);
      } finally {
        setOpeningSessionId("");
      }
    },
    [
      apiGetJson,
      blockingPending,
      isStreaming,
      resetPending,
      setActiveTurnTrace,
      setCurrentSessionId,
      setEvents,
      setHookTimeline,
      setExecutionState,
      setLastUserText,
      setMcpRuntimeStatus,
      setMessages,
      setOpeningSessionId,
      setTraceByAssistantId
    ]
  );

  const startNewSession = useCallback((options = {}) => {
    const force = options?.force === true;
    if (!force && (isStreaming || blockingPending)) return;
    setCurrentSessionId(null);
    setMessages([]);
    setEvents([]);
    setHookTimeline([]);
    if (typeof setAgentUsage === "function") setAgentUsage({});
    setLastUserText("");
    resetRuntimeUsage();
    resetPending();
    setExecutionState({
      phase: "idle",
      phaseDetail: "",
      phaseStartedAt: 0,
      phaseEtaSeconds: null,
      lastActivityAt: 0,
      currentAgent: "",
      currentTool: "",
      toolElapsedSeconds: 0,
      lastDeltaAt: 0,
      taskRuntime: { tasks: {}, running: 0, completed: 0, failed: 0, stopped: 0, parallelPeak: 0 },
      actions: [],
      dismissNoDelta: false
    });
    setMcpRuntimeStatus({ ok: null, count: 0, error: "", status: "unknown" });
    setTraceByAssistantId({});
    setActiveTurnTrace(null);
  }, [
    blockingPending,
    isStreaming,
    resetPending,
    resetRuntimeUsage,
    setActiveTurnTrace,
    setCurrentSessionId,
    setEvents,
    setHookTimeline,
    setExecutionState,
    setLastUserText,
    setMcpRuntimeStatus,
    setMessages,
    setTraceByAssistantId
  ]);

  return { openSession, startNewSession };
}
