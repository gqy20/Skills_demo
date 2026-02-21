import { useCallback, useMemo, useState } from "react";

export const INITIAL_PENDING_STATE = {
  byId: {},
  order: [],
  activeId: null,
  drafts: {}
};

export function upsertPendingState(prev, kind, data) {
  const requestId = data?.requestId;
  if (!requestId) return prev;
  const old = prev.byId[requestId] || {};
  const nextItem = {
    ...old,
    requestId,
    kind,
    toolName: data?.toolName || old.toolName || "",
    input: data?.input || old.input || {},
    suggestions: data?.suggestions || old.suggestions || [],
    status: "pending"
  };
  return {
    ...prev,
    byId: { ...prev.byId, [requestId]: nextItem },
    order: prev.order.includes(requestId) ? prev.order : [...prev.order, requestId],
    activeId: prev.activeId || requestId
  };
}

export function resolvePendingState(prev, data) {
  const requestId = data?.requestId;
  if (!requestId || !prev.byId[requestId]) return prev;
  const nextById = { ...prev.byId };
  delete nextById[requestId];
  const nextOrder = prev.order.filter((id) => id !== requestId);
  return {
    ...prev,
    byId: nextById,
    order: nextOrder,
    activeId: nextOrder[0] || null
  };
}

export function setPendingDraftState(prev, requestId, askQuestionsLength, next) {
  if (!requestId) return prev;
  return {
    ...prev,
    drafts: {
      ...prev.drafts,
      [requestId]: {
        index: Math.min(Math.max(next.index ?? 0, 0), Math.max(askQuestionsLength - 1, 0)),
        answers: { ...(next.answers || {}) }
      }
    }
  };
}

export function usePendingState(apiPostJson) {
  const [pendingState, setPendingState] = useState(INITIAL_PENDING_STATE);

  const upsertPending = useCallback((kind, data) => {
    setPendingState((prev) => upsertPendingState(prev, kind, data));
  }, []);

  const resolvePending = useCallback((data) => {
    setPendingState((prev) => resolvePendingState(prev, data));
  }, []);

  const resetPending = useCallback(() => {
    setPendingState(INITIAL_PENDING_STATE);
  }, []);

  const activePending = pendingState.activeId ? pendingState.byId[pendingState.activeId] : null;
  const askQuestions = Array.isArray(activePending?.input?.questions) ? activePending.input.questions : [];
  const draft = activePending
    ? pendingState.drafts[activePending.requestId] || { index: 0, answers: {} }
    : { index: 0, answers: {} };
  const currentAsk = askQuestions[draft.index];

  const setAskDraft = useCallback(
    (next) => {
      if (!activePending) return;
      setPendingState((prev) => setPendingDraftState(prev, activePending.requestId, askQuestions.length, next));
    },
    [activePending, askQuestions.length]
  );

  const submitPending = useCallback(
    async (requestId, payload) => {
      await apiPostJson("/api/input", { requestId, ...payload });
      resolvePending({ requestId });
    },
    [apiPostJson, resolvePending]
  );

  const cancelPending = useCallback(
    async (requestId) => {
      await apiPostJson("/api/input/cancel", { requestId });
      resolvePending({ requestId });
    },
    [apiPostJson, resolvePending]
  );

  const blockingPending = useMemo(() => Boolean(activePending), [activePending]);

  return {
    pendingState,
    activePending,
    askQuestions,
    draft,
    currentAsk,
    blockingPending,
    upsertPending,
    resolvePending,
    setAskDraft,
    submitPending,
    cancelPending,
    resetPending
  };
}
