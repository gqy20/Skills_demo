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
  onDeleteSession,
  isStreaming,
  blockingPending,
  collapsed = false,
  onToggleCollapse
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
    <aside className={`session-sidebar${collapsed ? " is-collapsed" : ""}`}>
      <div className="session-sidebar-head">
        {/* 折叠/展开按钮 */}
        <button
          type="button"
          className="session-collapse-btn"
          onClick={onToggleCollapse}
          title={collapsed ? "展开对话记录" : "收起对话记录"}
          aria-label={collapsed ? "展开" : "收起"}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            {collapsed ? (
              /* 展开：两个向右箭头 */
              <path d="M5 4l4 4-4 4M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            ) : (
              /* 收起：两个向左箭头 */
              <path d="M11 4L7 8l4 4M7 4L3 8l4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            )}
          </svg>
        </button>

        {!collapsed && <span className="session-sidebar-title">对话记录</span>}

        {/* 新建对话按钮 */}
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

      {!collapsed && (
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
                    <div key={s.id} className="session-item-wrap">
                      <button
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
                      <button
                        type="button"
                        className="session-delete-btn"
                        onClick={(e) => { e.stopPropagation(); onDeleteSession?.(s.id); }}
                        title="删除对话"
                        aria-label="删除对话"
                        tabIndex={-1}
                      >
                        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
                          <path d="M2 2l9 9M11 2l-9 9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
                        </svg>
                      </button>
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      )}
    </aside>
  );
}
