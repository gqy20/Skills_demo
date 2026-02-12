const form = document.getElementById("chat-form");
const messageInput = document.getElementById("message");
const sendBtn = document.getElementById("send-btn");
const replyEl = document.getElementById("reply");
const eventsEl = document.getElementById("events");
const pendingEl = document.getElementById("pending");

const pendingQueue = [];
let pendingActive = null;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function resolvePending(payload) {
  const response = await fetch("/api/input", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || response.statusText);
  }
}

function renderPendingEmpty() {
  pendingEl.className = "pending-empty";
  pendingEl.textContent = "当前没有待处理交互";
}

function popAndRenderNextPending() {
  pendingActive = pendingQueue.shift() || null;
  if (!pendingActive) {
    renderPendingEmpty();
    return;
  }

  if (pendingActive.type === "permission_request") {
    const tool = escapeHtml(pendingActive.toolName || "unknown");
    const input = escapeHtml(JSON.stringify(pendingActive.input || {}, null, 2));
    pendingEl.className = "";
    pendingEl.innerHTML = `
      <p><strong>Tool Permission Request</strong></p>
      <p>tool: <code>${tool}</code></p>
      <pre class="output">${input}</pre>
      <div class="pending-actions">
        <button id="pending-allow" type="button">允许</button>
        <button id="pending-deny" type="button">拒绝</button>
      </div>
    `;

    pendingEl.querySelector("#pending-allow").addEventListener("click", async () => {
      try {
        await resolvePending({
          requestId: pendingActive.requestId,
          behavior: "allow"
        });
        popAndRenderNextPending();
      } catch (error) {
        alert(`提交失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    pendingEl.querySelector("#pending-deny").addEventListener("click", async () => {
      try {
        await resolvePending({
          requestId: pendingActive.requestId,
          behavior: "deny",
          message: "User denied from web UI."
        });
        popAndRenderNextPending();
      } catch (error) {
        alert(`提交失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
    return;
  }

  if (pendingActive.type === "ask_user_question") {
    const questions = Array.isArray(pendingActive.input?.questions) ? pendingActive.input.questions : [];
    const blocks = questions
      .map((q, index) => {
        const title = escapeHtml(q?.question || `Question ${index + 1}`);
        const options = Array.isArray(q?.options) ? q.options : [];
        const optionsHtml = options
          .map((opt, optIndex) => {
            const label = escapeHtml(opt?.label || `Option ${optIndex + 1}`);
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
      <form id="pending-ask-form">
        ${blocks}
        <div class="pending-actions">
          <button type="submit">提交答案</button>
          <button type="button" id="pending-deny">拒绝</button>
        </div>
      </form>
    `;

    const formEl = pendingEl.querySelector("#pending-ask-form");
    const denyBtn = pendingEl.querySelector("#pending-deny");

    formEl.addEventListener("submit", async (event) => {
      event.preventDefault();
      const answers = {};

      questions.forEach((q, index) => {
        const radio = formEl.querySelector(`input[name="q_${index}"]:checked`);
        const freeInput = formEl.querySelector(`input[data-free-input="${index}"]`);
        const label = q?.id || q?.question || `q_${index}`;
        const value = freeInput?.value?.trim() || radio?.value || "";
        if (value) answers[label] = value;
      });

      try {
        await resolvePending({
          requestId: pendingActive.requestId,
          behavior: "allow",
          updatedInput: {
            ...(pendingActive.input || {}),
            answers
          }
        });
        popAndRenderNextPending();
      } catch (error) {
        alert(`提交失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    denyBtn.addEventListener("click", async () => {
      try {
        await resolvePending({
          requestId: pendingActive.requestId,
          behavior: "deny",
          message: "User denied AskUserQuestion from web UI."
        });
        popAndRenderNextPending();
      } catch (error) {
        alert(`提交失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
    return;
  }

  renderPendingEmpty();
}

function enqueuePending(event) {
  pendingQueue.push(event);
  if (!pendingActive) {
    popAndRenderNextPending();
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const message = messageInput.value.trim();
  if (!message) return;

  sendBtn.disabled = true;
  replyEl.textContent = "处理中...";
  eventsEl.textContent = "[]";
  pendingQueue.length = 0;
  pendingActive = null;
  renderPendingEmpty();

  try {
    const response = await fetch("/api/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message })
    });

    if (!response.ok) {
      const errText = await response.text();
      replyEl.textContent = `请求失败: ${errText || response.statusText}`;
      return;
    }

    if (!response.body) {
      replyEl.textContent = "请求失败: 浏览器不支持流式读取";
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const events = [];
    const replyParts = [];

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let evt;
        try {
          evt = JSON.parse(trimmed);
        } catch {
          continue;
        }

        events.push(evt);
        eventsEl.textContent = JSON.stringify(events, null, 2);

        if (evt.type === "ask_user_question" || evt.type === "permission_request") {
          enqueuePending(evt);
          continue;
        }

        if (evt.type === "error") {
          replyEl.textContent = `请求异常: ${evt.text || "unknown error"}`;
          continue;
        }

        const text = typeof evt.text === "string" ? evt.text.trim() : "";
        if (!text) continue;

        if (
          String(evt.type || "").includes("assistant") ||
          String(evt.type || "").includes("result") ||
          String(evt.type || "").includes("message")
        ) {
          replyParts.push(text);
          replyEl.textContent = replyParts.join("\n\n");
        }
      }
    }

    if (!replyParts.length) {
      replyEl.textContent = "(流式完成，但没有提取到文本回复，请查看 Events)";
    }
  } catch (error) {
    replyEl.textContent = `请求异常: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    sendBtn.disabled = false;
  }
});
