function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function pendingLabel(kind, toolName) {
  return kind === "ask_user_question" ? "AskUserQuestion" : toolName || "Permission";
}

function renderPendingQueue(activeList, activePendingId) {
  if (!activeList.length) return '<p class="hint">待处理队列: 0</p>';
  return `<ul class="pending-queue">${activeList
    .map((item) => {
      const requestId = escapeHtml(item.requestId);
      const label = escapeHtml(pendingLabel(item.kind, item.toolName));
      return `<li class="${item.requestId === activePendingId ? "is-active" : ""}"><code>${requestId.slice(0, 8)}</code> ${label} <span class="pending-badge pending-badge-pending">pending</span></li>`;
    })
    .join("")}</ul>`;
}

function renderPendingHistory(history) {
  if (!history.length) return '<p class="hint">暂无历史状态</p>';
  return `<ul class="pending-history">${history
    .map((item) => {
      const label = escapeHtml(pendingLabel(item.kind, item.toolName));
      const status = escapeHtml(item.status);
      const badgeClass = `pending-badge-${status}`.replace(/[^a-z-]/g, "");
      return `<li><span>${label}</span> <span class="pending-badge ${badgeClass}">${status}</span></li>`;
    })
    .join("")}</ul>`;
}

function collectAskAnswers(form, questions) {
  const answers = {};
  questions.forEach((q, index) => {
    const key = q?.id || q?.question || `q_${index}`;
    const selected = form.querySelector(`input[name="q_${index}"]:checked`)?.value || "";
    const custom = form.querySelector(`input[data-free-input="${index}"]`)?.value?.trim() || "";
    const answer = custom || selected;
    if (answer) answers[key] = answer;
  });
  return answers;
}

const askWizardDraftByRequest = new Map();

function getAskDraft(requestId, questionCount) {
  const existing = askWizardDraftByRequest.get(requestId);
  if (existing && typeof existing === "object") {
    existing.index = Math.min(Math.max(Number(existing.index) || 0, 0), Math.max(questionCount - 1, 0));
    if (!existing.answers || typeof existing.answers !== "object") existing.answers = {};
    return existing;
  }
  const next = { index: 0, answers: {} };
  askWizardDraftByRequest.set(requestId, next);
  return next;
}

function saveCurrentAskAnswer(form, question, questionIndex, answers) {
  if (!question) return;
  const key = question?.id || question?.question || `q_${questionIndex}`;
  const selected = form.querySelector(`input[name="q_${questionIndex}"]:checked`)?.value || "";
  const custom = form.querySelector(`input[data-free-input="${questionIndex}"]`)?.value?.trim() || "";
  const answer = custom || selected;
  if (answer) {
    answers[key] = answer;
  } else {
    delete answers[key];
  }
}

function renderDiagnostics(diagnostics) {
  const toolGateEnabled = diagnostics?.toolGateEnabled !== false;
  const gateHits = Number(diagnostics?.gateHits || 0);
  const askCreated = Number(diagnostics?.askCreated || 0);
  const askResolved = Number(diagnostics?.askResolved || 0);
  const lastToolName = escapeHtml(diagnostics?.lastToolName || "-");
  const lastEvent = escapeHtml(diagnostics?.lastEvent || "-");
  const sdkToolCount = diagnostics?.sdkToolCount;
  const sdkHasAskTool = diagnostics?.sdkHasAskTool;
  const sdkPermissionMode = escapeHtml(diagnostics?.sdkPermissionMode || "-");
  const gateStatus = toolGateEnabled ? "ON" : "OFF";
  const warning = toolGateEnabled
    ? ""
    : '<p class="pending-warning">交互网关已关闭：AskUserQuestion 不会触发。</p>';
  const sdkSummary =
    typeof sdkHasAskTool === "boolean"
      ? `sdkAskTool=${sdkHasAskTool ? "yes" : "no"} · sdkTools=${Number(sdkToolCount || 0)} · sdkMode=${sdkPermissionMode}`
      : "sdk init 未收到";
  return `
    <div class="pending-debug">
      <p><strong>Debug</strong> Gate=${gateStatus} | Hits=${gateHits} | Ask=${askCreated}/${askResolved}</p>
      <p class="hint">lastTool=${lastToolName} · lastEvent=${lastEvent}</p>
      <p class="hint">${sdkSummary}</p>
      ${warning}
    </div>
  `;
}

export function renderPendingPanel({
  pendingEl,
  active,
  activeList,
  history,
  diagnostics,
  activePendingId,
  onPermissionAllow,
  onPermissionDeny,
  onPermissionCancel,
  onAskSubmit,
  onAskDeny,
  onAskCancel
}) {
  const queueList = renderPendingQueue(activeList, activePendingId);
  const historyList = renderPendingHistory(history);
  const diagnosticsHtml = renderDiagnostics(diagnostics);

  if (!active) {
    pendingEl.className = "pending-empty";
    pendingEl.innerHTML = `${diagnosticsHtml}<p>当前没有待处理交互</p><h3>最近状态</h3>${historyList}`;
    return;
  }
  const queueBadge = `<h3>待处理队列</h3>${queueList}`;

  if (active.kind === "permission_request") {
    const tool = escapeHtml(active.toolName || "unknown");
    const input = escapeHtml(JSON.stringify(active.input || {}, null, 2));
    pendingEl.className = "";
    pendingEl.innerHTML = `
      ${diagnosticsHtml}
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

    pendingEl.querySelector("#pending-allow")?.addEventListener("click", async () => {
      const alwaysAllow = pendingEl.querySelector("#always-allow")?.checked === true;
      await onPermissionAllow(active.requestId, alwaysAllow);
    });
    pendingEl.querySelector("#pending-deny")?.addEventListener("click", async () => {
      await onPermissionDeny(active.requestId);
    });
    pendingEl.querySelector("#pending-cancel")?.addEventListener("click", async () => {
      await onPermissionCancel(active.requestId);
    });
    return;
  }

  const questions = Array.isArray(active.input?.questions) ? active.input.questions : [];
  const draft = getAskDraft(active.requestId, questions.length);
  const currentIndex = draft.index;
  const currentQuestion = questions[currentIndex];
  const currentKey = currentQuestion?.id || currentQuestion?.question || `q_${currentIndex}`;
  const currentSavedAnswer = typeof draft.answers?.[currentKey] === "string" ? draft.answers[currentKey] : "";
  const currentOptions = Array.isArray(currentQuestion?.options) ? currentQuestion.options : [];
  const matchedOption =
    currentOptions.find((opt) => (opt?.label || "").trim() === currentSavedAnswer.trim())?.label || "";
  const customValue = matchedOption ? "" : currentSavedAnswer;
  const optionsHtml = currentOptions
    .map((opt, i) => {
      const label = escapeHtml(opt?.label || `Option ${i + 1}`);
      const checked = matchedOption === (opt?.label || "") ? "checked" : "";
      return `<label class="pending-option"><input type="radio" name="q_${currentIndex}" value="${label}" ${checked} /> ${label}</label>`;
    })
    .join("");
  const formHtml = currentQuestion
    ? `
      <fieldset class="pending-fieldset">
        <legend>问题 ${currentIndex + 1} / ${questions.length}</legend>
        <p>${escapeHtml(currentQuestion?.question || `Question ${currentIndex + 1}`)}</p>
        ${optionsHtml || "<p>无预置选项，请填写文本答案。</p>"}
        <input data-free-input="${currentIndex}" type="text" placeholder="可选：自定义答案" value="${escapeHtml(customValue)}" />
      </fieldset>
    `
    : '<p class="hint">没有可展示的问题，直接提交将透传原始输入。</p>';

  pendingEl.className = "";
  pendingEl.innerHTML = `
    ${diagnosticsHtml}
    <p><strong>AskUserQuestion</strong></p>
    ${queueBadge}
    <form id="ask-form">
      ${formHtml}
      <div class="pending-actions">
        <button type="button" id="ask-prev" ${currentIndex <= 0 ? "disabled" : ""}>上一题</button>
        <button type="button" id="ask-next" ${currentIndex >= questions.length - 1 ? "disabled" : ""}>下一题</button>
        <button type="submit">${questions.length > 1 ? "提交全部答案" : "提交答案"}</button>
        <button type="button" id="ask-deny">拒绝</button>
        <button type="button" id="ask-cancel">取消请求</button>
      </div>
    </form>
    <h3>最近状态</h3>
    ${historyList}
  `;

  const askForm = pendingEl.querySelector("#ask-form");
  pendingEl.querySelector("#ask-prev")?.addEventListener("click", () => {
    saveCurrentAskAnswer(askForm, currentQuestion, currentIndex, draft.answers);
    draft.index = Math.max(0, currentIndex - 1);
    askWizardDraftByRequest.set(active.requestId, draft);
    renderPendingPanel({
      pendingEl,
      active,
      activeList,
      history,
      diagnostics,
      activePendingId,
      onPermissionAllow,
      onPermissionDeny,
      onPermissionCancel,
      onAskSubmit,
      onAskDeny,
      onAskCancel
    });
  });
  pendingEl.querySelector("#ask-next")?.addEventListener("click", () => {
    saveCurrentAskAnswer(askForm, currentQuestion, currentIndex, draft.answers);
    draft.index = Math.min(questions.length - 1, currentIndex + 1);
    askWizardDraftByRequest.set(active.requestId, draft);
    renderPendingPanel({
      pendingEl,
      active,
      activeList,
      history,
      diagnostics,
      activePendingId,
      onPermissionAllow,
      onPermissionDeny,
      onPermissionCancel,
      onAskSubmit,
      onAskDeny,
      onAskCancel
    });
  });
  askForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    saveCurrentAskAnswer(askForm, currentQuestion, currentIndex, draft.answers);
    const answers = { ...draft.answers, ...collectAskAnswers(askForm, questions) };
    askWizardDraftByRequest.delete(active.requestId);
    await onAskSubmit(active.requestId, answers, active.input || {});
  });

  pendingEl.querySelector("#ask-deny")?.addEventListener("click", async () => {
    askWizardDraftByRequest.delete(active.requestId);
    await onAskDeny(active.requestId);
  });

  pendingEl.querySelector("#ask-cancel")?.addEventListener("click", async () => {
    askWizardDraftByRequest.delete(active.requestId);
    await onAskCancel(active.requestId);
  });
}
