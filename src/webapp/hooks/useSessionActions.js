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
  setLastUserText,
  resetRuntimeUsage
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
        setExecutionState({
          phase: "idle",
          currentTool: "",
          toolElapsedSeconds: 0,
          lastDeltaAt: 0,
          actions: [],
          dismissNoDelta: false
        });
        setMcpRuntimeStatus({ ok: null, count: 0, error: "" });
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
      setExecutionState,
      setLastUserText,
      setMcpRuntimeStatus,
      setMessages,
      setOpeningSessionId,
      setTraceByAssistantId
    ]
  );

  const startNewSession = useCallback(() => {
    if (isStreaming || blockingPending) return;
    setCurrentSessionId(null);
    setMessages([]);
    setEvents([]);
    setLastUserText("");
    resetRuntimeUsage();
    resetPending();
    setExecutionState({
      phase: "idle",
      currentTool: "",
      toolElapsedSeconds: 0,
      lastDeltaAt: 0,
      actions: [],
      dismissNoDelta: false
    });
    setMcpRuntimeStatus({ ok: null, count: 0, error: "" });
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
    setExecutionState,
    setLastUserText,
    setMcpRuntimeStatus,
    setMessages,
    setTraceByAssistantId
  ]);

  return { openSession, startNewSession };
}
