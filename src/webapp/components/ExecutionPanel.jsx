import React from "react";
import { formatElapsed } from "../lib/chatUtils.js";

export default function ExecutionPanel({
  show,
  blockingPending,
  executionState,
  silentSeconds,
  isStreaming,
  settings,
  mcpRuntimeStatus,
  showNoDeltaHint,
  onDismissNoDelta,
  onForceStopAndRetry
}) {
  if (!show) return null;

  return (
    <section className="exec-panel">
      <div className="exec-head">
        <strong>
          {blockingPending
            ? "等待授权"
            : executionState.phase === "responding"
              ? "正在整理回复"
              : executionState.phase === "tool"
                ? "工具执行中"
                : "处理中"}
        </strong>
        {executionState.currentTool && <span className="exec-tool">{executionState.currentTool}</span>}
      </div>
      <div className="exec-meta">
        {executionState.toolElapsedSeconds > 0 && <span>工具耗时 {formatElapsed(executionState.toolElapsedSeconds)}</span>}
        {silentSeconds > 0 && isStreaming && <span>最近无文本增量 {formatElapsed(silentSeconds)}</span>}
        {!blockingPending && settings.permissionProfile === "full_auto" && <span>权限模式：全部允许</span>}
        {mcpRuntimeStatus.ok === true && <span>MCP 连接正常（{mcpRuntimeStatus.count}）</span>}
        {mcpRuntimeStatus.ok === false && <span className="exec-meta-warning">MCP 异常：{mcpRuntimeStatus.error || "连接失败"}</span>}
      </div>
      {executionState.actions.length > 0 && (
        <ul className="exec-actions">
          {executionState.actions.slice(-3).map((item, idx) => (
            <li key={`${item}-${idx}`}>{item}</li>
          ))}
        </ul>
      )}
      {showNoDeltaHint && (
        <div className="exec-hint">
          <span>暂无文本输出，正在等待工具返回结果...</span>
          <div className="exec-hint-actions">
            <button type="button" className="btn-secondary" onClick={onDismissNoDelta}>
              继续等待
            </button>
            <button type="button" className="btn-secondary" onClick={onForceStopAndRetry}>
              停止并重试
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
