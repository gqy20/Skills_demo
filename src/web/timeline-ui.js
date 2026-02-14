function applyMessageNodeState(article, textEl, msg) {
  article.className = `bubble ${msg.role === "user" ? "bubble-user" : "bubble-assistant"}`.trim();
  if (msg.status === "streaming") article.classList.add("bubble-streaming");
  if (msg.status === "streaming" && msg.text === "处理中...") article.classList.add("bubble-processing");
  if (msg.status === "error") article.classList.add("bubble-error");
  if (msg.status === "stopped") article.classList.add("bubble-stopped");
  textEl.textContent = msg.text;
}

export function createTimelineController(timelineEl, stickyThresholdPx = 80) {
  let messages = [];
  const messageNodeMap = new Map();
  let timelineInnerEl = null;

  function scrollBottom() {
    timelineEl.scrollTop = timelineEl.scrollHeight;
  }

  function shouldStickToBottom() {
    const remaining = timelineEl.scrollHeight - timelineEl.scrollTop - timelineEl.clientHeight;
    return remaining <= stickyThresholdPx;
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

  function setMessages(nextMessages) {
    messages = Array.isArray(nextMessages) ? nextMessages : [];
  }

  function createMessage(role, text, status = "complete") {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const next = { id, role, text, status };
    messages.push(next);
    appendMessageNode(next, true);
    scrollBottom();
    return id;
  }

  function updateMessage(id, updater) {
    const idx = messages.findIndex((item) => item.id === id);
    if (idx < 0) return;
    const prev = messages[idx];
    const next = typeof updater === "function" ? updater(prev) : { ...prev, ...updater };
    messages[idx] = next;
    const cachedNode = messageNodeMap.get(id);
    if (!cachedNode) {
      renderTimeline();
      return;
    }
    const stickToBottom = shouldStickToBottom();
    applyMessageNodeState(cachedNode.article, cachedNode.textEl, next);
    if (stickToBottom) scrollBottom();
  }

  function renderTimeline() {
    timelineEl.innerHTML = "";
    messageNodeMap.clear();
    timelineInnerEl = document.createElement("div");
    timelineInnerEl.className = "timeline-inner";
    for (const msg of messages) {
      appendMessageNode(msg, false);
    }
    timelineEl.appendChild(timelineInnerEl);
    scrollBottom();
  }

  return {
    setMessages,
    getMessages: () => messages,
    createMessage,
    updateMessage,
    renderTimeline,
    focusBottom: scrollBottom
  };
}
