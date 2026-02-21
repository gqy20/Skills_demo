import React from "react";

function stageLabel(stage) {
  const map = {
    queued: "已入队",
    sdk_init: "SDK 初始化",
    waiting_permission: "等待权限确认",
    waiting_user_input: "等待用户输入",
    hook_started: "Hook 开始",
    hook_progress: "Hook 进行中",
    hook_response: "Hook 返回",
    tool_progress: "工具执行中",
    tool_summary: "工具摘要",
    first_text_timeout: "首字超时",
    responding: "生成回复中",
    result: "结果返回",
    completed: "完成"
  };
  return map[String(stage || "")] || String(stage || "");
}

function formatHookTime(ts) {
  const n = Number(ts || 0);
  if (!Number.isFinite(n) || n <= 0) return "--:--:--";
  return new Date(n).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function HookTimeline({ items }) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return null;

  return (
    <section className="hook-timeline" aria-label="Hook timeline">
      <div className="hook-timeline-head">
        <strong>执行阶段</strong>
        <span>{list.length} 条</span>
      </div>
      <ul className="hook-timeline-list">
        {list.slice(-8).reverse().map((item, idx) => (
          <li key={`${item?.at || 0}-${item?.stage || "unknown"}-${idx}`}>
            <span className="hook-time">{formatHookTime(item?.at)}</span>
            <span className="hook-stage">{stageLabel(item?.stage)}</span>
            {item?.hookEvent && <span className="hook-detail">{item.hookEvent}</span>}
            {item?.hookName && <span className="hook-detail">{item.hookName}</span>}
            {item?.toolName && <span className="hook-detail">{item.toolName}</span>}
            {item?.outcome && <span className="hook-outcome">{item.outcome}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
