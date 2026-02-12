const form = document.getElementById("chat-form");
const messageInput = document.getElementById("message");
const sendBtn = document.getElementById("send-btn");
const timelineEl = document.getElementById("timeline");
const eventsEl = document.getElementById("events");
const sessionMetaEl = document.getElementById("session-meta");
const pendingEl = document.getElementById("pending");
const openSettingsBtn = document.getElementById("open-settings");
const closeSettingsBtn = document.getElementById("close-settings");
const settingsModal = document.getElementById("settings-modal");
const settingsForm = document.getElementById("settings-form");
const settingModelInput = document.getElementById("setting-model");
const settingBaseUrlInput = document.getElementById("setting-base-url");
const settingAuthTokenInput = document.getElementById("setting-auth-token");
const tokenPreviewEl = document.getElementById("token-preview");

let currentSessionId = null;
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
  tokenPreviewEl.textContent = data.hasToken
    ? `已配置 token: ${data.tokenPreview || "********"}`
    : "当前未配置 token";
}

async function saveSettings() {
  const payload = {
    model: settingModelInput.value.trim(),
    baseUrl: settingBaseUrlInput.value.trim(),
    authToken: settingAuthTokenInput.value.trim(),
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
  tokenPreviewEl.textContent = data.hasToken
    ? `已配置 token: ${data.tokenPreview || "********"}`
    : "当前未配置 token";
  settingAuthTokenInput.value = "";
}

function renderPendingEmpty() {
  pendingEl.className = "pending-empty";
  pendingEl.textContent = "当前没有待处理交互";
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
  pendingQueue.push(evt);
  if (!activePending) shiftPending();
}

function parseSseChunk(chunk, state, onEvent) {
  state.buffer += chunk;
  const parts = state.buffer.split("\n\n");
  state.buffer = parts.pop() || "";

  for (const part of parts) {
    const lines = part.split("\n");
    let eventName = "message";
    const dataLines = [];

    for (const line of lines) {
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trim());
      }
    }

    const rawData = dataLines.join("\n");
    if (!rawData) continue;

    try {
      onEvent(eventName, JSON.parse(rawData));
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
    const response = await fetch("/api/chat/sse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        sessionId: currentSessionId
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
    const replyParts = [];
    let receivedDelta = false;

    const onEvent = (eventName, data) => {
      events.push({ event: eventName, data });
      eventsEl.textContent = JSON.stringify(events, null, 2);

      if (eventName === "session" && data?.sessionId) {
        setSession(data.sessionId);
        return;
      }

      if (eventName === "permission_request" || eventName === "ask_user_question") {
        enqueuePending({ event: eventName, data });
        return;
      }

      if (eventName === "delta") {
        const delta = typeof data?.text === "string" ? data.text : "";
        if (delta) {
          receivedDelta = true;
          if (assistantTextNode.textContent === "处理中...") {
            assistantTextNode.textContent = "";
          }
          assistantTextNode.textContent += delta;
          scrollTimelineBottom();
        }
        return;
      }

      if (eventName === "error") {
        assistantTextNode.parentElement.classList.remove("bubble-streaming");
        assistantTextNode.parentElement.classList.add("bubble-error");
        assistantTextNode.textContent = `请求异常: ${data?.error || "unknown error"}`;
        return;
      }

      if (receivedDelta) {
        return;
      }

      const text = typeof data?.text === "string" ? data.text.trim() : "";
      const type = String(data?.type || "");
      if (!text) return;

      if (type.includes("assistant") || type.includes("result") || type.includes("message")) {
        replyParts.push(text);
        assistantTextNode.textContent = replyParts.join("\n\n");
        scrollTimelineBottom();
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      parseSseChunk(decoder.decode(value, { stream: true }), state, onEvent);
    }

    assistantTextNode.parentElement.classList.remove("bubble-streaming");

    if (!replyParts.length && !assistantTextNode.textContent.trim()) {
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
