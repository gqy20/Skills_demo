import React, { useMemo, useState } from "react";
import { describeMcpProbe, formatElapsed, formatPhaseLabel } from "../lib/chatUtils.js";
import HookTimeline from "./HookTimeline.jsx";

export default function ExecutionPanel({
  show,
  blockingPending,
  executionState,
  silentSeconds,
  isStreaming,
  settings,
  mcpRuntimeStatus,
  mcpProbeRuntime,
  hookTimeline = [],
  showHookTimeline = false,
  showNoDeltaHint,
  nowTick = Date.now()
}) {
  if (!show) return null;
  const [expanded, setExpanded] = useState(false);
  const probeInfo = describeMcpProbe(mcpProbeRuntime || {});
  const phaseElapsedSeconds =
    typeof executionState.phaseStartedAt === "number" && executionState.phaseStartedAt > 0
      ? Math.max(0, Math.floor((nowTick - executionState.phaseStartedAt) / 1000))
      : 0;
  const activityIdleSeconds =
    typeof executionState.lastActivityAt === "number" && executionState.lastActivityAt > 0
      ? Math.max(0, Math.floor((nowTick - executionState.lastActivityAt) / 1000))
      : 0;
  const etaSecondsRaw = Number(executionState.phaseEtaSeconds);
  const etaSeconds = Number.isFinite(etaSecondsRaw) ? Math.max(0, etaSecondsRaw - phaseElapsedSeconds) : null;
  const phaseTitle = formatPhaseLabel(executionState.phase);

  const hintText = showNoDeltaHint ? "等待工具/上游返回" : "";
  const latestAction = Array.isArray(executionState.actions) && executionState.actions.length > 0
    ? executionState.actions[executionState.actions.length - 1]
    : "";
  const mcpSummary =
    probeInfo.level === "warn" || probeInfo.level === "error"
      ? `MCP ${probeInfo.probe}`
      : mcpRuntimeStatus.ok === true
        ? `MCP 正常（${mcpRuntimeStatus.count}）`
        : "MCP 检测中";
  const compactText = useMemo(() => {
    const parts = [];
    if (executionState.currentTool) parts.push(`工具 ${executionState.currentTool}`);
    if (hintText) parts.push(hintText);
    else if (latestAction) parts.push(latestAction);
    else if (executionState.phaseDetail) parts.push(executionState.phaseDetail);
    else parts.push("正在处理请求");
    return parts.join(" · ");
  }, [
    executionState.currentTool,
    executionState.phaseDetail,
    hintText,
    latestAction,
    phaseElapsedSeconds,
    mcpSummary
  ]);

  return (
    <section className="exec-panel exec-panel-dock">
      <div className="exec-head">
        <div className="exec-head-status">
          <span className={`exec-status-dot ${executionState.phase === "error" ? "is-error" : ""}`} />
          <strong>
            {blockingPending
              ? "等待授权"
              : executionState.phase === "error"
                ? "请求异常"
                : phaseTitle}
          </strong>
        </div>
        <div className="exec-head-actions">
          <button type="button" className="activity-toggle" onClick={() => setExpanded((v) => !v)}>
            {expanded ? "收起详情" : "展开详情"}
          </button>
        </div>
      </div>
      <div className="exec-status-line exec-status-line-compact">
        <span className="exec-compact-main">{compactText}</span>
        <span className="exec-compact-chip">耗时 {formatElapsed(phaseElapsedSeconds)}</span>
        <span className="exec-compact-chip exec-compact-chip-mcp">{mcpSummary}</span>
      </div>
      {expanded && (
        <>
          <div className="exec-meta">
            {phaseElapsedSeconds > 0 && <span>阶段耗时 {formatElapsed(phaseElapsedSeconds)}</span>}
            {typeof etaSeconds === "number" && <span>预计剩余 {formatElapsed(etaSeconds)}</span>}
            {activityIdleSeconds > 0 && <span>最近活动 {formatElapsed(activityIdleSeconds)} 前</span>}
            {executionState.toolElapsedSeconds > 0 && <span>工具耗时 {formatElapsed(executionState.toolElapsedSeconds)}</span>}
            {silentSeconds > 0 && isStreaming && <span>最近无文本增量 {formatElapsed(silentSeconds)}</span>}
            {!blockingPending && settings.permissionProfile === "full_auto" && <span>权限模式：全部允许</span>}
            <span className={probeInfo.level === "warn" || probeInfo.level === "error" ? "exec-meta-warning" : ""}>
              MCP 探针：{probeInfo.probe} · 最近检测 {probeInfo.lastChecked}
            </span>
            {mcpRuntimeStatus.ok === true && <span>MCP 连接正常（{mcpRuntimeStatus.count}）</span>}
          </div>
          {executionState.phaseDetail && <div className="exec-phase-detail">{executionState.phaseDetail}</div>}
          {showHookTimeline && <HookTimeline items={hookTimeline} />}
        </>
      )}
    </section>
  );
}
