import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { formatElapsed, formatPhaseLabel, looksLikeToolClaim, textFromMessage } from "../lib/chatUtils.js";

export default function ChatMessageList({
  messages,
  lastAssistantId,
  isStreaming,
  traceByAssistantId,
  onCopyText,
  onRetryLast,
  lastUserText
}) {
  return messages.map((msg) => {
    const isLastAssistant = msg.role === "assistant" && lastAssistantId === msg.id;
    const text = textFromMessage(msg);
    const hasVisibleText = text.trim().length > 0;
    const showProcessing = msg.role === "assistant" && isLastAssistant && isStreaming && !hasVisibleText;
    const trace = msg.role === "assistant" ? traceByAssistantId[msg.id] || msg?.toolTrace || null : null;
    const traceToolEntries = trace ? Object.entries(trace.tools || {}) : [];
    const traceSkillEntries = trace ? Object.entries(trace.skills || {}) : [];
    const tracePhaseList = Array.isArray(trace?.phases) ? trace.phases : [];
    const unverifiedToolClaim =
      msg.role === "assistant" && traceToolEntries.length === 0 && traceSkillEntries.length === 0 && looksLikeToolClaim(text);
    if (msg.role === "assistant" && !showProcessing && !hasVisibleText) return null;

    return (
      <article
        key={msg.id}
        className={`bubble ${msg.role === "user" ? "bubble-user" : "bubble-assistant"} ${
          isLastAssistant && isStreaming && !showProcessing ? "bubble-streaming" : ""
        } ${showProcessing ? "bubble-processing" : ""}`}
      >
        {msg.role === "assistant" ? (
          showProcessing ? (
            <div className="processing-card">
              <p className="processing-title">处理中</p>
              <p className="processing-subtitle">正在整理结果，请稍候...</p>
              <div className="processing-skeleton">
                <span />
                <span />
                <span />
              </div>
            </div>
          ) : (
            <div className="assistant-content bubble-enter">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  table: ({ node, ...props }) => (
                    <div className="markdown-table-wrap">
                      <table {...props} />
                    </div>
                  )
                }}
              >
                {text}
              </ReactMarkdown>
              {(traceToolEntries.length > 0 || traceSkillEntries.length > 0 || tracePhaseList.length > 0) && (
                <div className="bubble-trace">
                  <p className="bubble-trace-title">本轮调用</p>
                  {traceSkillEntries.length > 0 && (
                    <ul>
                      {traceSkillEntries.slice(0, 4).map(([name, item]) => (
                        <li key={`skill-${name}`}>
                          <span>/{name}</span>
                          <em>x{item?.count || 1}</em>
                        </li>
                      ))}
                    </ul>
                  )}
                  {traceToolEntries.length > 0 && (
                    <ul>
                      {traceToolEntries.slice(0, 5).map(([name, item]) => (
                        <li key={`tool-${name}`}>
                          <span>{name}</span>
                          <em>
                            x{item?.count || 1}
                            {item?.elapsedSeconds > 0 ? ` · ${formatElapsed(item.elapsedSeconds)}` : ""}
                          </em>
                        </li>
                      ))}
                    </ul>
                  )}
                  {tracePhaseList.length > 0 && (
                    <p className="bubble-trace-phase">
                      阶段：{tracePhaseList.slice(-3).map((item) => formatPhaseLabel(item?.phase)).join(" -> ")}
                    </p>
                  )}
                </div>
              )}
              {unverifiedToolClaim && <div className="bubble-trace-warning">未检测到真实工具事件，当前内容可能是模型自述结果。</div>}
              {isLastAssistant && (
                <div className="bubble-actions">
                  <button type="button" className="bubble-action-btn" title="复制" aria-label="复制" onClick={() => onCopyText(text)}>
                    ⧉
                  </button>
                  <button
                    type="button"
                    className="bubble-action-btn"
                    title="重试"
                    aria-label="重试"
                    onClick={onRetryLast}
                    disabled={!lastUserText || isStreaming}
                  >
                    ↻
                  </button>
                </div>
              )}
            </div>
          )
        ) : (
          <p>{text}</p>
        )}
      </article>
    );
  });
}
