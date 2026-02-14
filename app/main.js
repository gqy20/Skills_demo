const form = document.getElementById("chat-form");
const messageInput = document.getElementById("message");
const sendBtn = document.getElementById("send-btn");
const stopBtn = document.getElementById("stop-btn");
const retryBtn = document.getElementById("retry-btn");
const timelineEl = document.getElementById("timeline");
const eventsEl = document.getElementById("events");
const sessionMetaEl = document.getElementById("session-meta");
const skillsMetaEl = document.getElementById("skills-meta");
const skillsListEl = document.getElementById("skills-list");
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
  currentAbortController: null
};
let skillsLoading = false;

function setSession(sessionId) {
  state.currentSessionId = sessionId || null;
  sessionMetaEl.textContent = state.currentSessionId ? `Session: ${state.currentSessionId}` : "Session: (new)";
}

function showSettingsModal(show) {
  settingsModal.classList.toggle("hidden", !show);
  settingsModal.setAttribute("aria-hidden", show ? "false" : "true");
}

function setMcpEnabled(enabled) {
  state.currentMcpEnabled = Boolean(enabled);
  toggleMcpBtn.textContent = `MCP: ${state.currentMcpEnabled ? "ON" : "OFF"}`;
  toggleMcpBtn.classList.toggle("is-off", !state.currentMcpEnabled);
  settingMcpEnabledInput.checked = state.currentMcpEnabled;
}

function setSpeedModeEnabled(enabled) {
  state.currentSpeedModeEnabled = Boolean(enabled);
  toggleSpeedBtn.textContent = `Speed: ${state.currentSpeedModeEnabled ? "ON" : "OFF"}`;
  toggleSpeedBtn.classList.toggle("is-off", !state.currentSpeedModeEnabled);
  settingSpeedEnabledInput.checked = state.currentSpeedModeEnabled;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function scrollTimelineBottom() {
  timelineEl.scrollTop = timelineEl.scrollHeight;
}

function setStreamingState(streaming) {
  state.isStreaming = Boolean(streaming);
  sendBtn.disabled = state.isStreaming;
  stopBtn.disabled = !state.isStreaming;
  retryBtn.disabled = state.isStreaming || !state.lastUserMessage;
}

function createMessage(role, text, status = "complete") {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  state.messages.push({ id, role, text, status });
  renderTimeline();
  return id;
}

function updateMessage(id, updater) {
  const idx = state.messages.findIndex((item) => item.id === id);
  if (idx < 0) return;
  const prev = state.messages[idx];
  const next = typeof updater === "function" ? updater(prev) : { ...prev, ...updater };
  state.messages[idx] = next;
  renderTimeline();
}

function renderTimeline() {
  timelineEl.innerHTML = "";
  const inner = document.createElement("div");
  inner.className = "timeline-inner";
  for (const msg of state.messages) {
    const article = document.createElement("article");
    article.className = `bubble ${msg.role === "user" ? "bubble-user" : "bubble-assistant"}`.trim();
    if (msg.status === "streaming") article.classList.add("bubble-streaming");
    if (msg.status === "streaming" && msg.text === "处理中...") article.classList.add("bubble-processing");
    if (msg.status === "error") article.classList.add("bubble-error");
    if (msg.status === "stopped") article.classList.add("bubble-stopped");
    const p = document.createElement("p");
    p.textContent = msg.text;
    article.appendChild(p);
    inner.appendChild(article);
  }
  timelineEl.appendChild(inner);
  scrollTimelineBottom();
}

async function resolvePending(payload) {
  const response = await fetch("/api/input", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error((await response.text()) || response.statusText);
  return response.json();
}

async function cancelPending(requestId) {
  const response = await fetch("/api/input/cancel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requestId })
  });
  if (!response.ok) throw new Error((await response.text()) || response.statusText);
  return response.json();
}

async function loadSettings() {
  const response = await fetch("/api/settings");
  if (!response.ok) throw new Error((await response.text()) || response.statusText);

  const data = await response.json();
  settingModelInput.value = data.model || "";
  settingBaseUrlInput.value = data.baseUrl || "";
  settingAuthTokenInput.value = "";
  setMcpEnabled(data.mcpEnabled !== false);
  setSpeedModeEnabled(data.speedModeEnabled === true);
  settingToolGateEnabledInput.checked = data.toolGateEnabled !== false;
  settingDebugEnabledInput.checked = data.debugEnabled === true;
  settingDebugSseEnabledInput.checked = data.debugSseEnabled === true;
  tokenPreviewEl.textContent = data.hasToken ? `已配置 token: ${data.tokenPreview || "********"}` : "当前未配置 token";
}

function renderSkills(items) {
  skillsListEl.innerHTML = "";
  for (const item of items) {
    const li = document.createElement("li");
    li.className = "skills-item";
    const head = document.createElement("div");
    head.className = "skills-head";
    const title = document.createElement("p");
    title.className = "skills-name";
    title.textContent = `/${item.name}`;
    const source = document.createElement("span");
    source.className = "skills-source";
    source.textContent = item.source === "user" ? "user" : "project";
    head.appendChild(title);
    head.appendChild(source);
    const desc = document.createElement("p");
    desc.className = "skills-desc";
    desc.textContent = item.description || "无描述";
    li.appendChild(head);
    li.appendChild(desc);
    if (item.argumentHint) {
      const hint = document.createElement("code");
      hint.className = "skills-arg";
      hint.textContent = item.argumentHint;
      li.appendChild(hint);
    }
    skillsListEl.appendChild(li);
  }
}

async function loadSkills() {
  if (skillsLoading) return;
  skillsLoading = true;
  skillsMetaEl.textContent = "加载中...";
  try {
    const response = await fetch("/api/skills");
    if (!response.ok) throw new Error((await response.text()) || response.statusText);
    const data = await response.json();
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

function buildSettingsPayload({ mcpEnabled, speedModeEnabled }) {
  return {
    model: settingModelInput.value.trim(),
    baseUrl: settingBaseUrlInput.value.trim(),
    authToken: settingAuthTokenInput.value.trim(),
    mcpEnabled,
    speedModeEnabled,
    toolGateEnabled: settingToolGateEnabledInput.checked,
    debugEnabled: settingDebugEnabledInput.checked,
    debugSseEnabled: settingDebugSseEnabledInput.checked,
    keepExistingToken: true
  };
}

async function saveSettingsWithPayload(payload) {
  const response = await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error((await response.text()) || response.statusText);

  const data = await response.json();
  setMcpEnabled(data.mcpEnabled !== false);
  setSpeedModeEnabled(data.speedModeEnabled === true);
  tokenPreviewEl.textContent = data.hasToken ? `已配置 token: ${data.tokenPreview || "********"}` : "当前未配置 token";
  settingAuthTokenInput.value = "";
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

function renderPendingPanel() {
  const active = getActivePending();
  const activeList = state.pendingOrder
    .map((id) => state.pendingById.get(id))
    .filter((item) => item?.status === "pending");
  const queueList = activeList.length
    ? `<ul class="pending-queue">${activeList
        .map((item) => {
          const requestId = escapeHtml(item.requestId);
          const label = escapeHtml(item.kind === "ask_user_question" ? "AskUserQuestion" : item.toolName || "Permission");
          return `<li class="${item.requestId === state.activePendingId ? "is-active" : ""}"><code>${requestId.slice(0, 8)}</code> ${label} <span class="pending-badge pending-badge-pending">pending</span></li>`;
        })
        .join("")}</ul>`
    : '<p class="hint">待处理队列: 0</p>';
  const historyList = state.pendingHistory.length
    ? `<ul class="pending-history">${state.pendingHistory
        .map((item) => {
          const label = escapeHtml(item.kind === "ask_user_question" ? "AskUserQuestion" : item.toolName || "Permission");
          const status = escapeHtml(item.status);
          const badgeClass = `pending-badge-${status}`.replace(/[^a-z-]/g, "");
          return `<li><span>${label}</span> <span class="pending-badge ${badgeClass}">${status}</span></li>`;
        })
        .join("")}</ul>`
    : '<p class="hint">暂无历史状态</p>';

  if (!active) {
    pendingEl.className = "pending-empty";
    pendingEl.innerHTML = `<p>当前没有待处理交互</p><h3>最近状态</h3>${historyList}`;
    return;
  }
  const queueBadge = `<h3>待处理队列</h3>${queueList}`;

  if (active.kind === "permission_request") {
    const tool = escapeHtml(active.toolName || "unknown");
    const input = escapeHtml(JSON.stringify(active.input || {}, null, 2));
    pendingEl.className = "";
    pendingEl.innerHTML = `
      <p><strong>Tool Permission Request</strong></p>
      ${queueBadge}
      <p>tool: <code>${tool}</code></p>
      <pre class="output">${input}</pre>
      <label class="pending-option">
        <input id="always-allow" type="checkbox" />
        同意并应用建议权限（always allow）
      </label>
      <div class="pending-actions">
        <button id="pending-allow" type="button">允许</button>
        <button id="pending-deny" type="button">拒绝</button>
        <button id="pending-cancel" type="button">取消请求</button>
      </div>
      <h3>最近状态</h3>
      ${historyList}
    `;

    pendingEl.querySelector("#pending-allow").addEventListener("click", async () => {
      try {
        await resolvePending({
          requestId: active.requestId,
          behavior: "allow",
          alwaysAllow: pendingEl.querySelector("#always-allow").checked
        });
        addPendingHistory(active, "allow");
        removePendingLocal(active.requestId);
      } catch (error) {
        alert(`提交失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    pendingEl.querySelector("#pending-deny").addEventListener("click", async () => {
      try {
        await resolvePending({ requestId: active.requestId, behavior: "deny", message: "User denied from web UI." });
        addPendingHistory(active, "deny");
        removePendingLocal(active.requestId);
      } catch (error) {
        alert(`提交失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    pendingEl.querySelector("#pending-cancel").addEventListener("click", async () => {
      try {
        await cancelPending(active.requestId);
        addPendingHistory(active, "canceled");
        removePendingLocal(active.requestId);
      } catch (error) {
        alert(`取消失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
    return;
  }

  const questions = Array.isArray(active.input?.questions) ? active.input.questions : [];
  const formHtml = questions
    .map((q, index) => {
      const title = escapeHtml(q?.question || `Question ${index + 1}`);
      const options = Array.isArray(q?.options) ? q.options : [];
      const optionsHtml = options
        .map((opt, i) => {
          const label = escapeHtml(opt?.label || `Option ${i + 1}`);
          return `<label class="pending-option"><input type="radio" name="q_${index}" value="${label}" /> ${label}</label>`;
        })
        .join("");
      return `
        <fieldset class="pending-fieldset">
          <legend>${title}</legend>
          ${optionsHtml || "<p>无预置选项，请填写文本答案。</p>"}
          <input data-free-input="${index}" type="text" placeholder="可选：自定义答案" />
        </fieldset>
      `;
    })
    .join("");

  pendingEl.className = "";
  pendingEl.innerHTML = `
    <p><strong>AskUserQuestion</strong></p>
    ${queueBadge}
    <form id="ask-form">
      ${formHtml}
      <div class="pending-actions">
        <button type="submit">提交答案</button>
        <button type="button" id="ask-deny">拒绝</button>
        <button type="button" id="ask-cancel">取消请求</button>
      </div>
    </form>
    <h3>最近状态</h3>
    ${historyList}
  `;

  const askForm = pendingEl.querySelector("#ask-form");
  const denyBtn = pendingEl.querySelector("#ask-deny");
  const cancelBtn = pendingEl.querySelector("#ask-cancel");

  askForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const answers = {};
    questions.forEach((q, index) => {
      const key = q?.id || q?.question || `q_${index}`;
      const selected = askForm.querySelector(`input[name="q_${index}"]:checked`)?.value || "";
      const custom = askForm.querySelector(`input[data-free-input="${index}"]`)?.value?.trim() || "";
      const answer = custom || selected;
      if (answer) answers[key] = answer;
    });

    try {
      await resolvePending({
        requestId: active.requestId,
        behavior: "allow",
        updatedInput: {
          ...(active.input || {}),
          answers
        }
      });
      addPendingHistory(active, "allow");
      removePendingLocal(active.requestId);
    } catch (error) {
      alert(`提交失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  denyBtn.addEventListener("click", async () => {
    try {
      await resolvePending({ requestId: active.requestId, behavior: "deny", message: "User denied AskUserQuestion." });
      addPendingHistory(active, "deny");
      removePendingLocal(active.requestId);
    } catch (error) {
      alert(`提交失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  cancelBtn.addEventListener("click", async () => {
    try {
      await cancelPending(active.requestId);
      addPendingHistory(active, "canceled");
      removePendingLocal(active.requestId);
    } catch (error) {
      alert(`取消失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}

function parseSseChunk(chunk, stateRef, onPayload) {
  stateRef.buffer += chunk;
  const parts = stateRef.buffer.split("\n\n");
  stateRef.buffer = parts.pop() || "";

  for (const part of parts) {
    const lines = part.split("\n");
    const dataLines = [];

    for (const line of lines) {
      if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }

    const rawData = dataLines.join("\n");
    if (!rawData) continue;
    if (rawData === "[DONE]") {
      onPayload({ type: "done" });
      continue;
    }

    try {
      onPayload(JSON.parse(rawData));
    } catch {
      // Ignore malformed frame.
    }
  }
}

setSession(null);
state.messages = [{ id: "init", role: "assistant", text: "准备就绪。输入任务后将实时显示回复。", status: "complete" }];
renderTimeline();
renderPendingPanel();
setStreamingState(false);
loadSettings().catch(() => {
  tokenPreviewEl.textContent = "配置读取失败，请稍后重试。";
});
loadSkills();
setInterval(loadSkills, 3000);

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

async function stopCurrentStream() {
  if (!state.isStreaming) return;
  const sessionId = state.currentSessionId;
  if (state.currentAbortController) {
    state.currentAbortController.abort();
  }
  if (sessionId) {
    try {
      await fetch("/api/chat/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: sessionId })
      });
    } catch {
      // best effort stop
    }
  }
}

async function sendMessage(message, isRetry) {
  if (state.isStreaming) return;
  if (!isRetry) {
    createMessage("user", message, "complete");
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
    const response = await fetch("/api/chat/ui", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: abortController.signal,
      body: JSON.stringify({
        id: state.currentSessionId || undefined,
        messages: [{ role: "user", content: message }]
      })
    });

    if (!response.ok) {
      updateMessage(assistantMessageId, {
        status: "error",
        text: `请求失败: ${(await response.text()) || response.statusText}`
      });
      return;
    }

    if (!response.body) {
      updateMessage(assistantMessageId, {
        status: "error",
        text: "请求失败: 浏览器不支持流式读取"
      });
      return;
    }

    const streamState = { buffer: "" };
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const payloadEvents = [];

    const onPayload = (payload) => {
      payloadEvents.push(payload);
      eventsEl.textContent = JSON.stringify(payloadEvents, null, 2);

      const type = String(payload?.type || "");
      if (!type) return;

      if (type === "data-session" && payload?.data?.sessionId) {
        setSession(payload.data.sessionId);
        return;
      }

      if (type === "data-ask-user-question-created") {
        upsertPendingFromLifecycle("ask_user_question", payload.data || {});
        return;
      }
      if (type === "data-permission-request-created") {
        upsertPendingFromLifecycle("permission_request", payload.data || {});
        return;
      }

      if (type === "data-ask-user-question-resolved" || type === "data-ask-user-question-timeout" || type === "data-ask-user-question-canceled") {
        resolvePendingLifecycle(payload.data || {}, type.replace("data-ask-user-question-", ""));
        return;
      }
      if (type === "data-permission-request-resolved" || type === "data-permission-request-timeout" || type === "data-permission-request-canceled") {
        resolvePendingLifecycle(payload.data || {}, type.replace("data-permission-request-", ""));
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

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      parseSseChunk(decoder.decode(value, { stream: true }), streamState, onPayload);
    }

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
    if (!isRetry) {
      messageInput.value = "";
    }
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
