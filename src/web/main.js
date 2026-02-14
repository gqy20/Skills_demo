import { apiGetJson as requestGetJson, apiPostJson as requestPostJson } from "./api.js";
import { streamChatUi } from "./chat.js";
import { renderPendingPanel as renderPendingUi } from "./pending-ui.js";
import {
  showSettingsModal as toggleSettingsModal,
  setMcpEnabled as applyMcpToggle,
  setSpeedModeEnabled as applySpeedToggle,
  applySettingsToForm,
  buildSettingsPayload as buildSettingsPayloadFromForm,
  applySavedSettings
} from "./settings-ui.js";
import { renderSkills as renderSkillsList, renderFilesPanel as renderFilesTree } from "./inspector-ui.js";

const form = document.getElementById("chat-form");
const messageInput = document.getElementById("message");
const sendBtn = document.getElementById("send-btn");
const stopBtn = document.getElementById("stop-btn");
const retryBtn = document.getElementById("retry-btn");
const timelineEl = document.getElementById("timeline");
const eventsEl = document.getElementById("events");
const workspaceSelectEl = document.getElementById("workspace-select");
const workspaceMetaEl = document.getElementById("workspace-meta");
const sessionMetaEl = document.getElementById("session-meta");
const skillsMetaEl = document.getElementById("skills-meta");
const skillsListEl = document.getElementById("skills-list");
const filesMetaEl = document.getElementById("files-meta");
const filesListEl = document.getElementById("files-list");
const pendingEl = document.getElementById("pending");
const openSettingsBtn = document.getElementById("open-settings");
const closeSettingsBtn = document.getElementById("close-settings");
const toggleMcpBtn = document.getElementById("toggle-mcp");
const toggleSpeedBtn = document.getElementById("toggle-speed");
const settingsModal = document.getElementById("settings-modal");
const settingsForm = document.getElementById("settings-form");
const settingModelInput = document.getElementById("setting-model");
const settingBaseUrlInput = document.getElementById("setting-base-url");
const settingAuthTokenInput = document.getElementById("setting-auth-token");
const settingMcpEnabledInput = document.getElementById("setting-mcp-enabled");
const settingSpeedEnabledInput = document.getElementById("setting-speed-enabled");
const settingToolGateEnabledInput = document.getElementById("setting-tool-gate-enabled");
const settingDebugEnabledInput = document.getElementById("setting-debug-enabled");
const settingDebugSseEnabledInput = document.getElementById("setting-debug-sse-enabled");
const tokenPreviewEl = document.getElementById("token-preview");

const state = {
  currentWorkspaceId: "",
  currentSessionId: null,
  currentMcpEnabled: true,
  currentSpeedModeEnabled: false,
  messages: [],
  pendingById: new Map(),
  pendingOrder: [],
  pendingHistory: [],
  activePendingId: null,
  lastUserMessage: "",
  isStreaming: false,
  currentAbortController: null,
  fileTree: new Map(),
  fileExpanded: new Set([""]),
  fileLoading: new Set(),
  workspaces: []
};
let skillsLoading = false;
let isComposing = false;
const MAX_EVENT_LOG = 120;
const ASK_EVENT_PREFIX = "data-ask-user-question-";
const PERMISSION_EVENT_PREFIX = "data-permission-request-";

const CREATED_EVENT_KIND = {
  [`${ASK_EVENT_PREFIX}created`]: "ask_user_question",
  [`${PERMISSION_EVENT_PREFIX}created`]: "permission_request"
};
const SCROLL_STICKY_THRESHOLD_PX = 80;
const messageNodeMap = new Map();
let timelineInnerEl = null;

function setSession(sessionId) {
  state.currentSessionId = sessionId || null;
  sessionMetaEl.textContent = state.currentSessionId ? `Session: ${state.currentSessionId}` : "Session: (new)";
}

async function apiGetJson(pathname, params = {}) {
  return requestGetJson(pathname, params, state.currentWorkspaceId);
}

async function apiPostJson(pathname, body = {}) {
  return requestPostJson(pathname, body, state.currentWorkspaceId);
}

function showSettingsModal(show) {
  toggleSettingsModal(settingsModal, show);
}

function setMcpEnabled(enabled) {
  applyMcpToggle(enabled, { state, toggleMcpBtn, settingMcpEnabledInput });
}

function setSpeedModeEnabled(enabled) {
  applySpeedToggle(enabled, { state, toggleSpeedBtn, settingSpeedEnabledInput });
}

function scrollTimelineBottom() {
  timelineEl.scrollTop = timelineEl.scrollHeight;
}

function shouldStickToBottom() {
  const remaining = timelineEl.scrollHeight - timelineEl.scrollTop - timelineEl.clientHeight;
  return remaining <= SCROLL_STICKY_THRESHOLD_PX;
}

function setStreamingState(streaming) {
  state.isStreaming = Boolean(streaming);
  sendBtn.disabled = state.isStreaming;
  stopBtn.disabled = !state.isStreaming;
  retryBtn.disabled = state.isStreaming || !state.lastUserMessage;
}

function createMessage(role, text, status = "complete") {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const next = { id, role, text, status };
  state.messages.push(next);
  appendMessageNode(next, true);
  scrollTimelineBottom();
  return id;
}

function updateMessage(id, updater) {
  const idx = state.messages.findIndex((item) => item.id === id);
  if (idx < 0) return;
  const prev = state.messages[idx];
  const next = typeof updater === "function" ? updater(prev) : { ...prev, ...updater };
  state.messages[idx] = next;
  const cachedNode = messageNodeMap.get(id);
  if (!cachedNode) {
    renderTimeline();
    return;
  }
  const stickToBottom = shouldStickToBottom();
  applyMessageNodeState(cachedNode.article, cachedNode.textEl, next);
  if (stickToBottom) scrollTimelineBottom();
}

function applyMessageNodeState(article, textEl, msg) {
  article.className = `bubble ${msg.role === "user" ? "bubble-user" : "bubble-assistant"}`.trim();
  if (msg.status === "streaming") article.classList.add("bubble-streaming");
  if (msg.status === "streaming" && msg.text === "处理中...") article.classList.add("bubble-processing");
  if (msg.status === "error") article.classList.add("bubble-error");
  if (msg.status === "stopped") article.classList.add("bubble-stopped");
  textEl.textContent = msg.text;
}

function appendMessageNode(msg, animate) {
  if (!timelineInnerEl) {
    timelineInnerEl = document.createElement("div");
    timelineInnerEl.className = "timeline-inner";
    timelineEl.appendChild(timelineInnerEl);
  }
  const article = document.createElement("article");
  const textEl = document.createElement("p");
  applyMessageNodeState(article, textEl, msg);
  if (animate) {
    article.classList.add("bubble-enter");
    article.addEventListener(
      "animationend",
      () => {
        article.classList.remove("bubble-enter");
      },
      { once: true }
    );
  }
  article.appendChild(textEl);
  timelineInnerEl.appendChild(article);
  messageNodeMap.set(msg.id, { article, textEl });
}

function renderTimeline() {
  timelineEl.innerHTML = "";
  messageNodeMap.clear();
  timelineInnerEl = document.createElement("div");
  timelineInnerEl.className = "timeline-inner";
  for (const msg of state.messages) {
    appendMessageNode(msg, false);
  }
  timelineEl.appendChild(timelineInnerEl);
  scrollTimelineBottom();
}

async function resolvePending(payload) {
  return apiPostJson("/api/input", payload);
}

async function cancelPending(requestId) {
  return apiPostJson("/api/input/cancel", { requestId });
}

async function loadSettings() {
  const data = await apiGetJson("/api/settings");
  if (data.workspaceId && data.workspaceId !== state.currentWorkspaceId) {
    state.currentWorkspaceId = data.workspaceId;
    renderWorkspaceOptions();
  }
  applySettingsToForm(data, {
    settingModelInput,
    settingBaseUrlInput,
    settingAuthTokenInput,
    settingToolGateEnabledInput,
    settingDebugEnabledInput,
    settingDebugSseEnabledInput,
    tokenPreviewEl
  });
  setMcpEnabled(data.mcpEnabled !== false);
  setSpeedModeEnabled(data.speedModeEnabled === true);
}

function renderSkills(items) {
  renderSkillsList(items, skillsListEl);
}

function renderFilesPanel() {
  renderFilesTree({
    filesListEl,
    filesMetaEl,
    fileTree: state.fileTree,
    fileExpanded: state.fileExpanded,
    fileLoading: state.fileLoading
  });
}

async function loadFiles(path = "", depth = 1) {
  if (state.fileLoading.has(path)) return;
  state.fileLoading.add(path);
  if (!state.fileTree.has(path)) {
    filesMetaEl.textContent = "加载中...";
  }
  try {
    const data = await apiGetJson("/api/files", { path, depth });
    const items = Array.isArray(data.items) ? data.items : [];
    state.fileTree.set(path, items);
    renderFilesPanel();
  } catch (error) {
    filesMetaEl.textContent = `加载失败: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    state.fileLoading.delete(path);
    renderFilesPanel();
  }
}

async function loadSkills() {
  if (skillsLoading) return;
  skillsLoading = true;
  skillsMetaEl.textContent = "加载中...";
  try {
    const data = await apiGetJson("/api/skills");
    const items = Array.isArray(data.items) ? data.items : [];
    skillsMetaEl.textContent = `仅显示用户/项目 skills，共 ${items.length} 个`;
    renderSkills(items);
  } catch (error) {
    skillsMetaEl.textContent = `加载失败: ${error instanceof Error ? error.message : String(error)}`;
    skillsListEl.innerHTML = "";
  } finally {
    skillsLoading = false;
  }
}

function renderWorkspaceOptions() {
  workspaceSelectEl.innerHTML = "";
  for (const item of state.workspaces) {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.label;
    workspaceSelectEl.appendChild(option);
  }
  if (state.currentWorkspaceId) {
    workspaceSelectEl.value = state.currentWorkspaceId;
  }
  const current = state.workspaces.find((item) => item.id === state.currentWorkspaceId);
  workspaceMetaEl.textContent = current ? current.root : "";
}

async function loadWorkspaces() {
  const data = await apiGetJson("/api/workspaces", { workspaceId: "" });
  const items = Array.isArray(data.items) ? data.items : [];
  state.workspaces = items;
  if (!state.currentWorkspaceId) {
    state.currentWorkspaceId = data.currentWorkspaceId || (items[0] ? items[0].id : "");
  }
  renderWorkspaceOptions();
}

async function switchWorkspace(workspaceId) {
  if (!workspaceId || workspaceId === state.currentWorkspaceId) return;
  state.currentWorkspaceId = workspaceId;
  renderWorkspaceOptions();
  setSession(null);
  state.pendingById.clear();
  state.pendingOrder = [];
  state.activePendingId = null;
  state.pendingHistory = [];
  state.messages = [{ id: "init", role: "assistant", text: "准备就绪。输入任务后将实时显示回复。", status: "complete" }];
  renderTimeline();
  renderPendingPanel();
  state.fileTree.clear();
  state.fileExpanded = new Set([""]);
  await Promise.allSettled([loadSettings(), loadSkills(), loadFiles()]);
}

function buildSettingsPayload({ mcpEnabled, speedModeEnabled }) {
  return buildSettingsPayloadFromForm(
    {
      settingModelInput,
      settingBaseUrlInput,
      settingAuthTokenInput,
      settingToolGateEnabledInput,
      settingDebugEnabledInput,
      settingDebugSseEnabledInput
    },
    { mcpEnabled, speedModeEnabled }
  );
}

async function saveSettingsWithPayload(payload) {
  const data = await apiPostJson("/api/settings", payload);
  setMcpEnabled(data.mcpEnabled !== false);
  setSpeedModeEnabled(data.speedModeEnabled === true);
  applySavedSettings(data, { settingAuthTokenInput, tokenPreviewEl });
  await loadSkills();
  return data;
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

function removePendingLocal(requestId) {
  if (!requestId) return;
  state.pendingById.delete(requestId);
  state.pendingOrder = state.pendingOrder.filter((id) => id !== requestId);
  if (state.activePendingId === requestId) state.activePendingId = null;
  renderPendingPanel();
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

function upsertPendingFromLifecycle(kind, data) {
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
  renderPendingPanel();
}

function resolvePendingLifecycle(data, status) {
  const requestId = data?.requestId;
  if (!requestId) return;
  const item = state.pendingById.get(requestId);
  if (!item) return;
  item.status = status;
  state.pendingById.set(requestId, item);
  addPendingHistory(item, status);
  removePendingLocal(requestId);
}

function getActivePendingList() {
  return state.pendingOrder
    .map((id) => state.pendingById.get(id))
    .filter((item) => item?.status === "pending");
}

function recordAndRemovePending(requestId, status) {
  const item = state.pendingById.get(requestId);
  if (item) addPendingHistory(item, status);
  removePendingLocal(requestId);
}

async function submitPendingDecision(requestId, payload, status, errorPrefix) {
  try {
    await resolvePending({ requestId, ...payload });
    recordAndRemovePending(requestId, status);
  } catch (error) {
    alert(`${errorPrefix}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function submitPendingCancel(requestId) {
  try {
    await cancelPending(requestId);
    recordAndRemovePending(requestId, "canceled");
  } catch (error) {
    alert(`取消失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function renderPendingPanel() {
  const active = getActivePending();
  renderPendingUi({
    pendingEl,
    active,
    activeList: getActivePendingList(),
    history: state.pendingHistory,
    activePendingId: state.activePendingId,
    onPermissionAllow: async (requestId, alwaysAllow) => {
      await submitPendingDecision(requestId, { behavior: "allow", alwaysAllow }, "allow", "提交失败");
    },
    onPermissionDeny: async (requestId) => {
      await submitPendingDecision(
        requestId,
        { behavior: "deny", message: "User denied from web UI." },
        "deny",
        "提交失败"
      );
    },
    onPermissionCancel: async (requestId) => {
      await submitPendingCancel(requestId);
    },
    onAskSubmit: async (requestId, answers, input) => {
      await submitPendingDecision(
        requestId,
        {
          behavior: "allow",
          updatedInput: {
            ...(input || {}),
            answers
          }
        },
        "allow",
        "提交失败"
      );
    },
    onAskDeny: async (requestId) => {
      await submitPendingDecision(
        requestId,
        { behavior: "deny", message: "User denied AskUserQuestion." },
        "deny",
        "提交失败"
      );
    },
    onAskCancel: async (requestId) => {
      await submitPendingCancel(requestId);
    }
  });
}

function routeLifecycleEvent(type, data) {
  const createdKind = CREATED_EVENT_KIND[type];
  if (createdKind) {
    upsertPendingFromLifecycle(createdKind, data || {});
    return true;
  }

  if (type.startsWith(ASK_EVENT_PREFIX)) {
    const status = type.slice(ASK_EVENT_PREFIX.length);
    if (status === "resolved" || status === "timeout" || status === "canceled") {
      resolvePendingLifecycle(data || {}, status);
      return true;
    }
    return false;
  }

  if (type.startsWith(PERMISSION_EVENT_PREFIX)) {
    const status = type.slice(PERMISSION_EVENT_PREFIX.length);
    if (status === "resolved" || status === "timeout" || status === "canceled") {
      resolvePendingLifecycle(data || {}, status);
      return true;
    }
    return false;
  }

  return false;
}

setSession(null);
state.messages = [{ id: "init", role: "assistant", text: "准备就绪。输入任务后将实时显示回复。", status: "complete" }];
renderTimeline();
renderPendingPanel();
setStreamingState(false);
loadWorkspaces()
  .then(() => Promise.all([loadSettings(), loadSkills(), loadFiles()]))
  .catch(() => {
    tokenPreviewEl.textContent = "配置读取失败，请稍后重试。";
    workspaceMetaEl.textContent = "工作区读取失败";
  });
setInterval(() => {
  if (document.hidden) return;
  loadSkills();
}, 3000);

workspaceSelectEl.addEventListener("change", async () => {
  await switchWorkspace(workspaceSelectEl.value);
});

filesListEl.addEventListener("click", async (event) => {
  const target = event.target instanceof Element ? event.target.closest(".files-row") : null;
  if (!target) return;
  const itemPath = target.dataset.path || "";
  const itemType = target.dataset.type || "";
  if (itemType !== "directory") return;
  if (state.fileExpanded.has(itemPath)) {
    state.fileExpanded.delete(itemPath);
    renderFilesPanel();
    return;
  }
  state.fileExpanded.add(itemPath);
  renderFilesPanel();
  if (!state.fileTree.has(itemPath)) {
    await loadFiles(itemPath, 1);
  }
});

toggleMcpBtn.addEventListener("click", async () => {
  try {
    await saveSettingsWithPayload(
      buildSettingsPayload({
        mcpEnabled: !state.currentMcpEnabled,
        speedModeEnabled: state.currentSpeedModeEnabled
      })
    );
  } catch (error) {
    alert(`切换 MCP 失败: ${error instanceof Error ? error.message : String(error)}`);
  }
});

toggleSpeedBtn.addEventListener("click", async () => {
  try {
    await saveSettingsWithPayload(
      buildSettingsPayload({
        mcpEnabled: state.currentMcpEnabled,
        speedModeEnabled: !state.currentSpeedModeEnabled
      })
    );
  } catch (error) {
    alert(`切换性能模式失败: ${error instanceof Error ? error.message : String(error)}`);
  }
});

openSettingsBtn.addEventListener("click", () => {
  loadSettings()
    .then(() => showSettingsModal(true))
    .catch((error) => {
      alert(`读取配置失败: ${error instanceof Error ? error.message : String(error)}`);
    });
});

closeSettingsBtn.addEventListener("click", () => showSettingsModal(false));

settingsModal.addEventListener("click", (event) => {
  if (event.target === settingsModal) showSettingsModal(false);
});

settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await saveSettingsWithPayload(
      buildSettingsPayload({
        mcpEnabled: settingMcpEnabledInput.checked,
        speedModeEnabled: settingSpeedEnabledInput.checked
      })
    );
    showSettingsModal(false);
  } catch (error) {
    alert(`保存失败: ${error instanceof Error ? error.message : String(error)}`);
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = messageInput.value.trim();
  if (!message) return;
  await sendMessage(message, false);
});

messageInput.addEventListener("compositionstart", () => {
  isComposing = true;
});

messageInput.addEventListener("compositionend", () => {
  isComposing = false;
});

messageInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  if (event.shiftKey) return;
  if (event.isComposing || isComposing) return;
  event.preventDefault();
  form.requestSubmit();
});

async function stopCurrentStream() {
  if (!state.isStreaming) return;
  const sessionId = state.currentSessionId;
  if (state.currentAbortController) {
    state.currentAbortController.abort();
  }
  if (sessionId) {
    try {
      await apiPostJson("/api/chat/stop", { id: sessionId });
    } catch {
      // best effort stop
    }
  }
}

async function sendMessage(message, isRetry) {
  if (state.isStreaming) return;
  if (!isRetry) {
    createMessage("user", message, "complete");
    messageInput.value = "";
  }
  state.lastUserMessage = message;
  setStreamingState(true);
  const assistantMessageId = createMessage("assistant", "处理中...", "streaming");
  eventsEl.textContent = "[]";

  state.pendingById.clear();
  state.pendingOrder = [];
  state.activePendingId = null;
  renderPendingPanel();

  const abortController = new AbortController();
  state.currentAbortController = abortController;
  try {
    const payloadEvents = [];

    const onPayload = (payload) => {
      payloadEvents.push(payload);
      if (payloadEvents.length > MAX_EVENT_LOG) {
        payloadEvents.splice(0, payloadEvents.length - MAX_EVENT_LOG);
      }
      eventsEl.textContent = JSON.stringify(payloadEvents, null, 2);

      const type = String(payload?.type || "");
      if (!type) return;

      if (type === "data-session" && payload?.data?.sessionId) {
        setSession(payload.data.sessionId);
        return;
      }

      if (routeLifecycleEvent(type, payload?.data)) {
        return;
      }

      if (type === "text-delta") {
        const delta = typeof payload?.delta === "string" ? payload.delta : "";
        if (!delta) return;
        updateMessage(assistantMessageId, (prev) => ({
          ...prev,
          status: "streaming",
          text: prev.text === "处理中..." ? delta : `${prev.text}${delta}`
        }));
        return;
      }

      if (type === "error") {
        updateMessage(assistantMessageId, {
          status: "error",
          text: `请求异常: ${payload?.error || "unknown error"}`
        });
      }
    };

    await streamChatUi({
      message,
      workspaceId: state.currentWorkspaceId,
      sessionId: state.currentSessionId,
      signal: abortController.signal,
      onPayload
    });

    updateMessage(assistantMessageId, (prev) => ({
      ...prev,
      status: prev.status === "error" ? "error" : "complete",
      text: !prev.text.trim() || prev.text === "处理中..." ? "(流式完成，但没有提取到文本回复，请查看 Events)" : prev.text
    }));
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      updateMessage(assistantMessageId, { status: "stopped", text: "已停止生成" });
    } else {
      updateMessage(assistantMessageId, {
        status: "error",
        text: `请求异常: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  } finally {
    state.currentAbortController = null;
    setStreamingState(false);
    messageInput.focus();
  }
}

stopBtn.addEventListener("click", async () => {
  await stopCurrentStream();
});

retryBtn.addEventListener("click", async () => {
  if (!state.lastUserMessage) return;
  await sendMessage(state.lastUserMessage, true);
});
