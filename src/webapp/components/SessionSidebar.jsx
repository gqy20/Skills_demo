import React, { useMemo } from "react";

function formatRelativeDate(ts) {
  const now = Date.now();
  const diff = now - ts;
  const day = 86400000;
  if (diff < day) return "今天";
  if (diff < 2 * day) return "昨天";
  if (diff < 7 * day) return "最近 7 天";
  if (diff < 30 * day) return "最近 30 天";
  const d = new Date(ts);
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`;
}

export default function SessionSidebar({
  sessions = [],
  sessionsLoading = false,
  currentSessionId,
  openingSessionId,
  onOpenSession,
  onNewSession,
  isStreaming,
  blockingPending
}) {
  const grouped = useMemo(() => {
    const buckets = new Map();
    const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
    for (const s of sorted) {
      const label = formatRelativeDate(s.updatedAt);
      if (!buckets.has(label)) buckets.set(label, []);
      buckets.get(label).push(s);
    }
    return Array.from(buckets.entries());
  }, [sessions]);

  const disabled = isStreaming || blockingPending;

  return (
    <aside className="session-sidebar">
      <div className="session-sidebar-head">
        <span className="session-sidebar-title">对话记录</span>
        <button
          type="button"
          className="session-new-btn"
          onClick={onNewSession}
          disabled={disabled}
          title="新建对话"
          aria-label="新建对话"
        >
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
            <path d="M7.5 2v11M2 7.5h11" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      <div className="session-list-wrap">
        {sessionsLoading && sessions.length === 0 ? (
          <div className="session-loading">
            <span /><span /><span />
          </div>
        ) : grouped.length === 0 ? (
          <p className="session-empty">暂无对话记录</p>
        ) : (
          grouped.map(([label, items]) => (
            <div key={label} className="session-group">
              <p className="session-group-label">{label}</p>
              {items.map((s) => {
                const isActive = s.id === currentSessionId;
                const isOpening = s.id === openingSessionId;
                return (
                  <button
                    key={s.id}
                    type="button"
                    className={`session-item ${isActive ? "is-active" : ""} ${isOpening ? "is-opening" : ""}`}
                    onClick={() => !isActive && onOpenSession(s.id)}
                    disabled={disabled && !isActive}
                    title={s.title}
                  >
                    <span className="session-item-title">{s.title || "未命名对话"}</span>
                    {s.lastPreview && (
                      <span className="session-item-preview">{s.lastPreview}</span>
                    )}
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
