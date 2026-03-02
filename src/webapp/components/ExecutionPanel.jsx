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
  skillUsageList = [],
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
  const taskRuntime = executionState.taskRuntime || {
    tasks: {},
    running: 0,
    completed: 0,
    failed: 0,
    stopped: 0,
    parallelPeak: 0
  };
  const taskRows = useMemo(
    () =>
      Object.values(taskRuntime.tasks || {})
        .sort((a, b) => Number(b?.updatedAt || 0) - Number(a?.updatedAt || 0))
        .slice(0, 6),
    [taskRuntime.tasks]
  );
  const ganttRows = useMemo(() => {
    if (!Array.isArray(taskRows) || taskRows.length === 0) return [];
    const rows = taskRows.map((item) => {
      const start = Number(item?.startedAt || item?.updatedAt || nowTick || Date.now());
      const endRaw = Number(item?.finishedAt || 0);
      const end = endRaw > 0 ? endRaw : nowTick;
      return { item, start, end };
    });
    const minStart = Math.min(...rows.map((row) => row.start));
    const maxEnd = Math.max(...rows.map((row) => row.end));
    const span = Math.max(1000, maxEnd - minStart);
    return rows.map((row) => {
      const left = ((row.start - minStart) / span) * 100;
      const width = Math.max(2, ((row.end - row.start) / span) * 100);
      return {
        item: row.item,
        left,
        width
      };
    });
  }, [nowTick, taskRows]);
  const taskSummaryText =
    taskRuntime.running > 0 || taskRuntime.completed > 0 || taskRuntime.failed > 0 || taskRuntime.stopped > 0
      ? `任务 ${taskRuntime.running} 运行中 · ${taskRuntime.completed} 完成 · ${taskRuntime.failed} 失败 · 峰值并行 ${taskRuntime.parallelPeak}`
      : "";
  const skillSummary = useMemo(() => {
    if (!Array.isArray(skillUsageList) || skillUsageList.length === 0) return "";
    const names = skillUsageList
      .slice(0, 3)
      .map((item) => String(item?.name || "").trim())
      .filter(Boolean)
      .map((name) => (name.startsWith("/") ? name : `/${name}`));
    if (names.length === 0) return "";
    const suffix = skillUsageList.length > names.length ? ` +${skillUsageList.length - names.length}` : "";
    return `Skills ${names.join(" ")}${suffix}`;
  }, [skillUsageList]);
  const compactText = useMemo(() => {
    const parts = [];
    if (skillSummary) parts.push(skillSummary);
    if (executionState.currentAgent) parts.push(`Agent ${executionState.currentAgent}`);
    if (executionState.currentTool) parts.push(`工具 ${executionState.currentTool}`);
    if (hintText) parts.push(hintText);
    else if (latestAction) parts.push(latestAction);
    else if (executionState.phaseDetail) parts.push(executionState.phaseDetail);
    else parts.push("正在处理请求");
    return parts.join(" · ");
  }, [
    executionState.currentAgent,
    executionState.currentTool,
    executionState.phaseDetail,
    hintText,
    latestAction,
    skillSummary
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
      {taskSummaryText && (
        <div className="exec-task-strip">
          <span className="exec-task-summary">{taskSummaryText}</span>
          <div className="exec-task-pills">
            {taskRows.map((item) => {
              const id = String(item?.taskId || "");
              const status = String(item?.status || "running");
              const label = String(item?.taskType || item?.description || id).trim() || id;
              return (
                <span key={id} className={`exec-task-pill is-${status}`}>
                  <span className="exec-task-pill-dot" />
                  {label}
                </span>
              );
            })}
          </div>
        </div>
      )}
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
          {ganttRows.length > 0 && (
            <div className="exec-task-gantt">
              <div className="exec-task-gantt-head">并行时间轴</div>
              <div className="exec-task-gantt-grid">
                {ganttRows.map((row) => {
                  const id = String(row.item?.taskId || "");
                  const status = String(row.item?.status || "running");
                  const label = String(row.item?.taskType || row.item?.description || id).trim() || id;
                  return (
                    <div key={`gantt-${id}`} className="exec-task-gantt-row">
                      <span className="exec-task-gantt-label">{label}</span>
                      <div className="exec-task-gantt-track">
                        <span
                          className={`exec-task-gantt-bar is-${status}`}
                          style={{ left: `${row.left}%`, width: `${row.width}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {taskRows.length > 0 && (
            <div className="exec-task-lanes">
              {taskRows.map((item) => {
                const id = String(item?.taskId || "");
                const status = String(item?.status || "running");
                const label = String(item?.taskType || item?.description || id).trim() || id;
                const detail = String(item?.lastToolName || item?.description || "").trim();
                return (
                  <div key={`lane-${id}`} className={`exec-task-lane is-${status}`}>
                    <div className="exec-task-lane-head">
                      <span className="exec-task-lane-title">{label}</span>
                      <span className={`exec-task-lane-status is-${status}`}>{status}</span>
                    </div>
                    {detail && <div className="exec-task-lane-detail">{detail}</div>}
                  </div>
                );
              })}
            </div>
          )}
          {showHookTimeline && <HookTimeline items={hookTimeline} />}
        </>
      )}
    </section>
  );
}
