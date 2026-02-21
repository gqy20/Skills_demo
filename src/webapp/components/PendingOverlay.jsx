import React from "react";

export default function PendingOverlay({
  blockingPending,
  activePending,
  askQuestions,
  draft,
  currentAsk,
  setAskDraft,
  submitPending,
  cancelPending
}) {
  return (
    <section id="pending-overlay" className={`pending-overlay ${blockingPending ? "" : "hidden"}`}>
      {blockingPending && (
        <>
          <p>
            <strong>{activePending.kind === "ask_user_question" ? "AskUserQuestion" : "Tool Permission"}</strong>
          </p>
          <p className="pending-why">为了继续执行任务，需要你先确认本步骤输入。</p>
          {activePending.kind === "permission_request" ? (
            <>
              <pre className="output">{JSON.stringify(activePending.input || {}, null, 2)}</pre>
              <div className="pending-actions">
                <button type="button" onClick={() => submitPending(activePending.requestId, { behavior: "allow", alwaysAllow: false })}>
                  允许
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => submitPending(activePending.requestId, { behavior: "deny", message: "User denied from web UI." })}
                >
                  拒绝
                </button>
                <button type="button" className="btn-secondary" onClick={() => cancelPending(activePending.requestId)}>
                  取消
                </button>
              </div>
            </>
          ) : (
            <>
              <fieldset className="pending-fieldset">
                <legend>
                  问题 {draft.index + 1}/{askQuestions.length}
                </legend>
                <p>{currentAsk?.question || "请回答当前问题"}</p>
                {Array.isArray(currentAsk?.options) &&
                  currentAsk.options.map((opt, idx) => {
                    const label = opt?.label || `Option ${idx + 1}`;
                    const key = currentAsk?.id || currentAsk?.question || `q_${draft.index}`;
                    const checked = draft.answers[key] === label;
                    return (
                      <label className="pending-option" key={`${label}-${idx}`}>
                        <input
                          type="radio"
                          name={`q_${draft.index}`}
                          checked={checked}
                          onChange={() => setAskDraft({ ...draft, answers: { ...draft.answers, [key]: label } })}
                        />{" "}
                        {label}
                      </label>
                    );
                  })}
              </fieldset>
              <div className="pending-actions">
                <button type="button" disabled={draft.index <= 0} onClick={() => setAskDraft({ ...draft, index: Math.max(0, draft.index - 1) })}>
                  上一题
                </button>
                <button
                  type="button"
                  disabled={draft.index >= askQuestions.length - 1}
                  onClick={() => setAskDraft({ ...draft, index: Math.min(askQuestions.length - 1, draft.index + 1) })}
                >
                  下一题
                </button>
                <button
                  type="button"
                  onClick={() =>
                    submitPending(activePending.requestId, {
                      behavior: "allow",
                      updatedInput: { ...(activePending.input || {}), answers: draft.answers }
                    })
                  }
                >
                  提交全部答案
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => submitPending(activePending.requestId, { behavior: "deny", message: "User denied AskUserQuestion." })}
                >
                  拒绝
                </button>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
