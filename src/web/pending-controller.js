export function createPendingController({ state, resolveRequest, cancelRequest, onChanged, onError }) {
  function notifyChanged() {
    onChanged();
  }

  function reset() {
    state.pendingById.clear();
    state.pendingOrder = [];
    state.activePendingId = null;
    state.pendingHistory = [];
    notifyChanged();
  }

  function removePendingLocal(requestId) {
    if (!requestId) return;
    state.pendingById.delete(requestId);
    state.pendingOrder = state.pendingOrder.filter((id) => id !== requestId);
    if (state.activePendingId === requestId) state.activePendingId = null;
  }

  function addPendingHistory(item, status) {
    state.pendingHistory.unshift({
      requestId: item.requestId,
      kind: item.kind,
      toolName: item.toolName,
      status,
      at: Date.now()
    });
    if (state.pendingHistory.length > 12) {
      state.pendingHistory = state.pendingHistory.slice(0, 12);
    }
  }

  function getActivePending() {
    const direct = state.activePendingId ? state.pendingById.get(state.activePendingId) : null;
    if (direct?.status === "pending") return direct;

    state.activePendingId = null;
    for (const requestId of state.pendingOrder) {
      const item = state.pendingById.get(requestId);
      if (item?.status === "pending") {
        state.activePendingId = requestId;
        return item;
      }
    }
    return null;
  }

  function getActivePendingList() {
    return state.pendingOrder
      .map((id) => state.pendingById.get(id))
      .filter((item) => item?.status === "pending");
  }

  function upsertFromLifecycle(kind, data) {
    const requestId = data?.requestId;
    if (!requestId) return;

    const prev = state.pendingById.get(requestId);
    const next = {
      requestId,
      kind,
      toolName: data.toolName || prev?.toolName || "",
      input: data.input || prev?.input || {},
      suggestions: data.suggestions || prev?.suggestions || [],
      createdAt: data.createdAt || prev?.createdAt || Date.now(),
      expiresAt: data.expiresAt || prev?.expiresAt || null,
      status: "pending"
    };
    state.pendingById.set(requestId, next);
    if (!state.pendingOrder.includes(requestId)) state.pendingOrder.push(requestId);
    if (!state.activePendingId) state.activePendingId = requestId;
    notifyChanged();
  }

  function resolveFromLifecycle(data, status) {
    const requestId = data?.requestId;
    if (!requestId) return;
    const item = state.pendingById.get(requestId);
    if (!item) return;
    item.status = status;
    state.pendingById.set(requestId, item);
    addPendingHistory(item, status);
    removePendingLocal(requestId);
    notifyChanged();
  }

  function recordAndRemovePending(requestId, status) {
    const item = state.pendingById.get(requestId);
    if (item) addPendingHistory(item, status);
    removePendingLocal(requestId);
    notifyChanged();
  }

  async function submitDecision(requestId, payload, status, errorPrefix) {
    try {
      await resolveRequest({ requestId, ...payload });
      recordAndRemovePending(requestId, status);
    } catch (error) {
      onError(`${errorPrefix}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function submitCancel(requestId) {
    try {
      await cancelRequest(requestId);
      recordAndRemovePending(requestId, "canceled");
    } catch (error) {
      onError(`取消失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    reset,
    getActivePending,
    getActivePendingList,
    getHistory: () => state.pendingHistory,
    getActivePendingId: () => state.activePendingId,
    upsertFromLifecycle,
    resolveFromLifecycle,
    submitDecision,
    submitCancel
  };
}
