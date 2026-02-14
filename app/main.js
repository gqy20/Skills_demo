const form = document.getElementById("chat-form");
const messageInput = document.getElementById("message");
const sendBtn = document.getElementById("send-btn");
const timelineEl = document.getElementById("timeline");
const eventsEl = document.getElementById("events");
const sessionMetaEl = document.getElementById("session-meta");
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

let currentSessionId = null;
let currentMcpEnabled = true;
let currentSpeedModeEnabled = false;
const pendingQueue = [];
let activePending = null;

function setSession(sessionId) {
  currentSessionId = sessionId || null;
  sessionMetaEl.textContent = currentSessionId ? `Session: ${currentSessionId}` : "Session: (new)";
}

function showSettingsModal(show) {
  settingsModal.classList.toggle("hidden", !show);
  settingsModal.setAttribute("aria-hidden", show ? "false" : "true");
}

function setMcpEnabled(enabled) {
  currentMcpEnabled = Boolean(enabled);
  toggleMcpBtn.textContent = `MCP: ${currentMcpEnabled ? "ON" : "OFF"}`;
  toggleMcpBtn.classList.toggle("is-off", !currentMcpEnabled);
  settingMcpEnabledInput.checked = currentMcpEnabled;
}

function setSpeedModeEnabled(enabled) {
  currentSpeedModeEnabled = Boolean(enabled);
  toggleSpeedBtn.textContent = `Speed: ${currentSpeedModeEnabled ? "ON" : "OFF"}`;
  toggleSpeedBtn.classList.toggle("is-off", !currentSpeedModeEnabled);
  settingSpeedEnabledInput.checked = currentSpeedModeEnabled;
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

function createBubble(role, text, extraClass = "") {
  const article = document.createElement("article");
  article.className = `bubble ${role === "user" ? "bubble-user" : "bubble-assistant"} ${extraClass}`.trim();
  const p = document.createElement("p");
  p.textContent = text;
  article.appendChild(p);
  timelineEl.appendChild(article);
  scrollTimelineBottom();
  return p;
}

async function resolvePending(payload) {
  const response = await fetch("/api/input", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error((await response.text()) || response.statusText);
  }
  return response.json();
}

async function loadSettings() {
  const response = await fetch("/api/settings");
  if (!response.ok) {
    throw new Error((await response.text()) || response.statusText);
  }
  const data = await response.json();
  settingModelInput.value = data.model || "";
  settingBaseUrlInput.value = data.baseUrl || "";
  settingAuthTokenInput.value = "";
  setMcpEnabled(data.mcpEnabled !== false);
  setSpeedModeEnabled(data.speedModeEnabled === true);
  settingToolGateEnabledInput.checked = data.toolGateEnabled !== false;
  settingDebugEnabledInput.checked = data.debugEnabled === true;
  settingDebugSseEnabledInput.checked = data.debugSseEnabled === true;
  tokenPreviewEl.textContent = data.hasToken
    ? `已配置 token: ${data.tokenPreview || "********"}`
    : "当前未配置 token";
}

async function saveSettings() {
  const payload = {
    model: settingModelInput.value.trim(),
    baseUrl: settingBaseUrlInput.value.trim(),
    authToken: settingAuthTokenInput.value.trim(),
    mcpEnabled: settingMcpEnabledInput.checked,
    speedModeEnabled: settingSpeedEnabledInput.checked,
    toolGateEnabled: settingToolGateEnabledInput.checked,
    debugEnabled: settingDebugEnabledInput.checked,
    debugSseEnabled: settingDebugSseEnabledInput.checked,
    keepExistingToken: true
  };
  const response = await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error((await response.text()) || response.statusText);
  }
  const data = await response.json();
  setMcpEnabled(data.mcpEnabled !== false);
  setSpeedModeEnabled(data.speedModeEnabled === true);
  tokenPreviewEl.textContent = data.hasToken
    ? `已配置 token: ${data.tokenPreview || "********"}`
    : "当前未配置 token";
  settingAuthTokenInput.value = "";
}

function renderPendingEmpty() {
  pendingEl.className = "pending-empty";
  pendingEl.textContent = "当前没有待处理交互";
}

function removePendingByRequestId(requestId) {
  if (!requestId) return;
  const idx = pendingQueue.findIndex((item) => item?.data?.requestId === requestId);
  if (idx >= 0) pendingQueue.splice(idx, 1);
  if (activePending?.data?.requestId === requestId) {
    activePending = null;
    shiftPending();
  }
}

function shiftPending() {
  activePending = pendingQueue.shift() || null;
  if (!activePending) {
    renderPendingEmpty();
    return;
  }

  if (activePending.event === "permission_request") {
    const tool = escapeHtml(activePending.data?.toolName || "unknown");
    const input = escapeHtml(JSON.stringify(activePending.data?.input || {}, null, 2));
    pendingEl.className = "";
    pendingEl.innerHTML = `
      <p><strong>Tool Permission Request</strong></p>
      <p>tool: <code>${tool}</code></p>
      <pre class="output">${input}</pre>
      <label class="pending-option">
        <input id="always-allow" type="checkbox" />
        同意并应用建议权限（always allow）
      </label>
      <div class="pending-actions">
        <button id="pending-allow" type="button">允许</button>
        <button id="pending-deny" type="button">拒绝</button>
      </div>
    `;

    pendingEl.querySelector("#pending-allow").addEventListener("click", async () => {
      try {
        await resolvePending({
          requestId: activePending.data.requestId,
          behavior: "allow",
          alwaysAllow: pendingEl.querySelector("#always-allow").checked
        });
        removePendingByRequestId(activePending.data.requestId);
        shiftPending();
      } catch (error) {
        alert(`提交失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    pendingEl.querySelector("#pending-deny").addEventListener("click", async () => {
      try {
        await resolvePending({
          requestId: activePending.data.requestId,
          behavior: "deny",
          message: "User denied from web UI."
        });
        removePendingByRequestId(activePending.data.requestId);
        shiftPending();
      } catch (error) {
        alert(`提交失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
    return;
  }

  if (activePending.event === "ask_user_question") {
    const questions = Array.isArray(activePending.data?.input?.questions) ? activePending.data.input.questions : [];
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
      <form id="ask-form">
        ${formHtml}
        <div class="pending-actions">
          <button type="submit">提交答案</button>
          <button type="button" id="ask-deny">拒绝</button>
        </div>
      </form>
    `;

    const askForm = pendingEl.querySelector("#ask-form");
    const denyBtn = pendingEl.querySelector("#ask-deny");

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
          requestId: activePending.data.requestId,
          behavior: "allow",
          updatedInput: {
            ...(activePending.data.input || {}),
            answers
          }
        });
        removePendingByRequestId(activePending.data.requestId);
        shiftPending();
      } catch (error) {
        alert(`提交失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    denyBtn.addEventListener("click", async () => {
      try {
        await resolvePending({
          requestId: activePending.data.requestId,
          behavior: "deny",
          message: "User denied AskUserQuestion from web UI."
        });
        removePendingByRequestId(activePending.data.requestId);
        shiftPending();
      } catch (error) {
        alert(`提交失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
    return;
  }

  renderPendingEmpty();
}

function enqueuePending(evt) {
  const requestId = evt?.data?.requestId;
  if (!requestId) return;
  const existing = pendingQueue.find((item) => item?.data?.requestId === requestId);
  if (existing) return;
  if (activePending?.data?.requestId === requestId) return;
  pendingQueue.push(evt);
  if (!activePending) shiftPending();
}

function parseSseChunk(chunk, state, onPayload) {
  state.buffer += chunk;
  const parts = state.buffer.split("\n\n");
  state.buffer = parts.pop() || "";

  for (const part of parts) {
    const lines = part.split("\n");
    const dataLines = [];

    for (const line of lines) {
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trim());
      }
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
      // ignore malformed event
    }
  }
}

setSession(null);
renderPendingEmpty();
loadSettings().catch(() => {
  tokenPreviewEl.textContent = "配置读取失败，请稍后重试。";
});

toggleMcpBtn.addEventListener("click", async () => {
  const next = !currentMcpEnabled;
  try {
    const payload = {
      model: settingModelInput.value.trim(),
      baseUrl: settingBaseUrlInput.value.trim(),
      authToken: "",
      mcpEnabled: next,
      speedModeEnabled: currentSpeedModeEnabled,
      toolGateEnabled: settingToolGateEnabledInput.checked,
      debugEnabled: settingDebugEnabledInput.checked,
      debugSseEnabled: settingDebugSseEnabledInput.checked,
      keepExistingToken: true
    };
    const response = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      throw new Error((await response.text()) || response.statusText);
    }
    const data = await response.json();
    setMcpEnabled(data.mcpEnabled !== false);
  } catch (error) {
    alert(`切换 MCP 失败: ${error instanceof Error ? error.message : String(error)}`);
  }
});

toggleSpeedBtn.addEventListener("click", async () => {
  const next = !currentSpeedModeEnabled;
  try {
    const payload = {
      model: settingModelInput.value.trim(),
      baseUrl: settingBaseUrlInput.value.trim(),
      authToken: "",
      mcpEnabled: currentMcpEnabled,
      speedModeEnabled: next,
      toolGateEnabled: settingToolGateEnabledInput.checked,
      debugEnabled: settingDebugEnabledInput.checked,
      debugSseEnabled: settingDebugSseEnabledInput.checked,
      keepExistingToken: true
    };
    const response = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      throw new Error((await response.text()) || response.statusText);
    }
    const data = await response.json();
    setSpeedModeEnabled(data.speedModeEnabled === true);
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
    await saveSettings();
    showSettingsModal(false);
  } catch (error) {
    alert(`保存失败: ${error instanceof Error ? error.message : String(error)}`);
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const message = messageInput.value.trim();
  if (!message) return;

  createBubble("user", message);
  const assistantTextNode = createBubble("assistant", "处理中...", "bubble-streaming");

  sendBtn.disabled = true;
  eventsEl.textContent = "[]";
  pendingQueue.length = 0;
  activePending = null;
  renderPendingEmpty();

  try {
    const response = await fetch("/api/chat/ui", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: currentSessionId || undefined,
        messages: [{ role: "user", content: message }]
      })
    });

    if (!response.ok) {
      assistantTextNode.parentElement.classList.remove("bubble-streaming");
      assistantTextNode.parentElement.classList.add("bubble-error");
      assistantTextNode.textContent = `请求失败: ${(await response.text()) || response.statusText}`;
      return;
    }

    if (!response.body) {
      assistantTextNode.parentElement.classList.remove("bubble-streaming");
      assistantTextNode.parentElement.classList.add("bubble-error");
      assistantTextNode.textContent = "请求失败: 浏览器不支持流式读取";
      return;
    }

    const state = { buffer: "" };
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const events = [];
    const onPayload = (payload) => {
      events.push(payload);
      eventsEl.textContent = JSON.stringify(events, null, 2);

      const type = String(payload?.type || "");
      if (!type) return;

      if (type === "data-session" && payload?.data?.sessionId) {
        setSession(payload.data.sessionId);
        return;
      }

      if (type === "data-permission-request-created") {
        enqueuePending({ event: "permission_request", data: payload?.data || {} });
        return;
      }

      if (type === "data-ask-user-question-created") {
        enqueuePending({ event: "ask_user_question", data: payload?.data || {} });
        return;
      }

      if (
        type === "data-permission-request-resolved" ||
        type === "data-permission-request-timeout" ||
        type === "data-permission-request-canceled" ||
        type === "data-ask-user-question-resolved" ||
        type === "data-ask-user-question-timeout" ||
        type === "data-ask-user-question-canceled"
      ) {
        removePendingByRequestId(payload?.data?.requestId);
        return;
      }

      if (type === "text-delta") {
        const delta = typeof payload?.delta === "string" ? payload.delta : "";
        if (!delta) return;
        if (assistantTextNode.textContent === "处理中...") {
          assistantTextNode.textContent = "";
        }
        assistantTextNode.textContent += delta;
        scrollTimelineBottom();
        return;
      }

      if (type === "error") {
        assistantTextNode.parentElement.classList.remove("bubble-streaming");
        assistantTextNode.parentElement.classList.add("bubble-error");
        assistantTextNode.textContent = `请求异常: ${payload?.error || "unknown error"}`;
        return;
      }

      if (type === "done" || type === "finish") {
        return;
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      parseSseChunk(decoder.decode(value, { stream: true }), state, onPayload);
    }

    assistantTextNode.parentElement.classList.remove("bubble-streaming");

    if (!assistantTextNode.textContent.trim() || assistantTextNode.textContent === "处理中...") {
      assistantTextNode.textContent = "(流式完成，但没有提取到文本回复，请查看 Events)";
    }
  } catch (error) {
    assistantTextNode.parentElement.classList.remove("bubble-streaming");
    assistantTextNode.parentElement.classList.add("bubble-error");
    assistantTextNode.textContent = `请求异常: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    sendBtn.disabled = false;
    messageInput.value = "";
    messageInput.focus();
  }
});
