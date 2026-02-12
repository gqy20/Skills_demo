const form = document.getElementById("chat-form");
const messageInput = document.getElementById("message");
const sendBtn = document.getElementById("send-btn");
const replyEl = document.getElementById("reply");
const eventsEl = document.getElementById("events");

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const message = messageInput.value.trim();
  if (!message) return;

  sendBtn.disabled = true;
  replyEl.textContent = "处理中...";
  eventsEl.textContent = "[]";

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
