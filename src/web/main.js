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
import { createTimelineController } from "./timeline-ui.js";
import { createDataLoader } from "./data-loader.js";
import { createPendingController } from "./pending-controller.js";

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
let isComposing = false;
const MAX_EVENT_LOG = 120;
const ASK_EVENT_PREFIX = "data-ask-user-question-";
const PERMISSION_EVENT_PREFIX = "data-permission-request-";

const CREATED_EVENT_KIND = {
  [`${ASK_EVENT_PREFIX}created`]: "ask_user_question",
  [`${PERMISSION_EVENT_PREFIX}created`]: "permission_request"
};
const SCROLL_STICKY_THRESHOLD_PX = 80;
const timeline = createTimelineController(timelineEl, SCROLL_STICKY_THRESHOLD_PX);

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

function setMcpEnabled(enabled) {
  applyMcpToggle(enabled, { state, toggleMcpBtn, settingMcpEnabledInput });
}

function setSpeedModeEnabled(enabled) {
  applySpeedToggle(enabled, { state, toggleSpeedBtn, settingSpeedEnabledInput });
}

function setStreamingState(streaming) {
  state.isStreaming = Boolean(streaming);
  sendBtn.disabled = state.isStreaming;
  stopBtn.disabled = !state.isStreaming;
  retryBtn.disabled = state.isStreaming || !state.lastUserMessage;
}

function createMessage(role, text, status = "complete") {
  return timeline.createMessage(role, text, status);
}

function updateMessage(id, updater) {
  timeline.updateMessage(id, updater);
}

function renderTimeline() {
  timeline.renderTimeline();
}

const dataLoader = createDataLoader({
  state,
  workspaceSelectEl,
  workspaceMetaEl,
  skillsMetaEl,
  skillsListEl,
  filesMetaEl,
  apiGetJson,
  applySettingsToForm: (data) =>
    applySettingsToForm(data, {
      settingModelInput,
      settingBaseUrlInput,
      settingAuthTokenInput,
      settingToolGateEnabledInput,
      settingDebugEnabledInput,
      settingDebugSseEnabledInput,
      tokenPreviewEl
    }),
  setMcpEnabled,
  setSpeedModeEnabled,
  renderSkills: (items) => renderSkillsList(items, skillsListEl),
  renderFilesPanel: () =>
    renderFilesTree({
      filesListEl,
      filesMetaEl,
      fileTree: state.fileTree,
      fileExpanded: state.fileExpanded,
      fileLoading: state.fileLoading
    })
});
const pendingController = createPendingController({
  state,
  resolveRequest: (payload) => apiPostJson("/api/input", payload),
  cancelRequest: (requestId) => apiPostJson("/api/input/cancel", { requestId }),
  onChanged: () => renderPendingPanel(),
  onError: (message) => alert(message)
});

async function switchWorkspace(workspaceId) {
  if (!workspaceId || workspaceId === state.currentWorkspaceId) return;
  state.currentWorkspaceId = workspaceId;
  dataLoader.renderWorkspaceOptions();
  setSession(null);
  pendingController.reset();
  timeline.setMessages([{ id: "init", role: "assistant", text: "准备就绪。输入任务后将实时显示回复。", status: "complete" }]);
  renderTimeline();
  state.fileTree.clear();
  state.fileExpanded = new Set([""]);
  await Promise.allSettled([dataLoader.loadSettings(), dataLoader.loadSkills(), dataLoader.loadFiles()]);
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
  await dataLoader.loadSkills();
  return data;
}

function renderPendingPanel() {
  const active = pendingController.getActivePending();
  renderPendingUi({
    pendingEl,
    active,
    activeList: pendingController.getActivePendingList(),
    history: pendingController.getHistory(),
    activePendingId: pendingController.getActivePendingId(),
    onPermissionAllow: async (requestId, alwaysAllow) => {
      await pendingController.submitDecision(requestId, { behavior: "allow", alwaysAllow }, "allow", "提交失败");
    },
    onPermissionDeny: async (requestId) => {
      await pendingController.submitDecision(
        requestId,
        { behavior: "deny", message: "User denied from web UI." },
        "deny",
        "提交失败"
      );
    },
    onPermissionCancel: async (requestId) => {
      await pendingController.submitCancel(requestId);
    },
    onAskSubmit: async (requestId, answers, input) => {
      await pendingController.submitDecision(
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
      await pendingController.submitDecision(
        requestId,
        { behavior: "deny", message: "User denied AskUserQuestion." },
        "deny",
        "提交失败"
      );
    },
    onAskCancel: async (requestId) => {
      await pendingController.submitCancel(requestId);
    }
  });
}

function routeLifecycleEvent(type, data) {
  const createdKind = CREATED_EVENT_KIND[type];
  if (createdKind) {
    pendingController.upsertFromLifecycle(createdKind, data || {});
    return true;
  }

  if (type.startsWith(ASK_EVENT_PREFIX)) {
    const status = type.slice(ASK_EVENT_PREFIX.length);
    if (status === "resolved" || status === "timeout" || status === "canceled") {
      pendingController.resolveFromLifecycle(data || {}, status);
      return true;
    }
    return false;
  }

  if (type.startsWith(PERMISSION_EVENT_PREFIX)) {
    const status = type.slice(PERMISSION_EVENT_PREFIX.length);
    if (status === "resolved" || status === "timeout" || status === "canceled") {
      pendingController.resolveFromLifecycle(data || {}, status);
      return true;
    }
    return false;
  }

  return false;
}

setSession(null);
timeline.setMessages([{ id: "init", role: "assistant", text: "准备就绪。输入任务后将实时显示回复。", status: "complete" }]);
renderTimeline();
renderPendingPanel();
setStreamingState(false);
dataLoader
  .loadWorkspaces()
  .then(() => Promise.all([dataLoader.loadSettings(), dataLoader.loadSkills(), dataLoader.loadFiles()]))
  .catch(() => {
    tokenPreviewEl.textContent = "配置读取失败，请稍后重试。";
    workspaceMetaEl.textContent = "工作区读取失败";
  });
dataLoader.startSkillsPolling(3000);

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
    renderFilesTree({
      filesListEl,
      filesMetaEl,
      fileTree: state.fileTree,
      fileExpanded: state.fileExpanded,
      fileLoading: state.fileLoading
    });
    return;
  }
  state.fileExpanded.add(itemPath);
  renderFilesTree({
    filesListEl,
    filesMetaEl,
    fileTree: state.fileTree,
    fileExpanded: state.fileExpanded,
    fileLoading: state.fileLoading
  });
  if (!state.fileTree.has(itemPath)) {
    await dataLoader.loadFiles(itemPath, 1);
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
  dataLoader
    .loadSettings()
    .then(() => toggleSettingsModal(settingsModal, true))
    .catch((error) => {
      alert(`读取配置失败: ${error instanceof Error ? error.message : String(error)}`);
    });
});

closeSettingsBtn.addEventListener("click", () => toggleSettingsModal(settingsModal, false));

settingsModal.addEventListener("click", (event) => {
  if (event.target === settingsModal) toggleSettingsModal(settingsModal, false);
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
    toggleSettingsModal(settingsModal, false);
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
  pendingController.reset();
  let pendingDelta = "";
  let rafId = 0;

  const flushDelta = () => {
    rafId = 0;
    if (!pendingDelta) return;
    const chunk = pendingDelta;
    pendingDelta = "";
    updateMessage(assistantMessageId, (prev) => ({
      ...prev,
      status: "streaming",
      text: prev.text === "处理中..." ? chunk : `${prev.text}${chunk}`
    }));
  };

  const queueDelta = (delta) => {
    pendingDelta += delta;
    if (rafId) return;
    rafId = requestAnimationFrame(flushDelta);
  };

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
        queueDelta(delta);
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

    if (rafId) cancelAnimationFrame(rafId);
    flushDelta();

    updateMessage(assistantMessageId, (prev) => ({
      ...prev,
      status: prev.status === "error" ? "error" : "complete",
      text: !prev.text.trim() || prev.text === "处理中..." ? "(流式完成，但没有提取到文本回复，请查看 Events)" : prev.text
    }));
  } catch (error) {
    if (rafId) cancelAnimationFrame(rafId);
    flushDelta();
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
