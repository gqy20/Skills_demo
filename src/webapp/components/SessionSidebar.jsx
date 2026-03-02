import React, { useMemo, useState } from "react";

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

function searchScore(query, item) {
  const q = String(query || "").toLowerCase();
  const name = String(item?.name || "").toLowerCase();
  const filePath = String(item?.path || "").toLowerCase();
  if (!q) return 0;

  let score = 0;
  if (name === q) score += 160;
  else if (name.startsWith(q)) score += 110;
  else if (name.includes(q)) score += 85;

  if (filePath.startsWith(q)) score += 40;
  else if (filePath.includes(q)) score += 24;

  let j = 0;
  for (let i = 0; i < name.length && j < q.length; i += 1) {
    if (name[i] === q[j]) j += 1;
  }
  if (j === q.length) score += 14;

  return score;
}

export default function SessionSidebar({
  sessions = [],
  sessionsLoading = false,
  currentSessionId,
  openingSessionId,
  onOpenSession,
  onNewSession,
  onDeleteSession,
  deletingSessionId = "",
  isStreaming,
  blockingPending,
  collapsed = false,
  onToggleCollapse,
  files = [],
  filteredFiles = [],
  fileFilter = "",
  setFileFilter = () => {},
  openFile = () => {},
  loadDirectoryChildren = () => {},
  onRefreshFiles = () => {},
  filesRefreshing = false,
  openedFilePath = ""
}) {
  const [activeTab, setActiveTab] = useState("sessions");
  const [expandedDirs, setExpandedDirs] = useState(() => new Set());
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
  const searchMode = String(fileFilter || "").trim().length > 0;
  const searchFiles = useMemo(() => {
    const q = String(fileFilter || "").trim().toLowerCase();
    return filteredFiles
      .filter((item) => item?.type === "file")
      .map((item) => ({ item, score: searchScore(q, item) }))
      .sort((a, b) => b.score - a.score || a.item.path.localeCompare(b.item.path))
      .map((row) => row.item);
  }, [fileFilter, filteredFiles]);

  const toggleDir = async (dir) => {
    if (!dir?.path) return;
    const path = dir.path;
    const willExpand = !expandedDirs.has(path);
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (willExpand) next.add(path);
      else next.delete(path);
      return next;
    });
    if (willExpand && dir.hasChildren && (!Array.isArray(dir.children) || dir.children.length === 0)) {
      await loadDirectoryChildren(path);
    }
  };

  const renderTreeNodes = (nodes, level = 0) =>
    (Array.isArray(nodes) ? nodes : []).map((node) => {
      if (!node || typeof node !== "object") return null;
      const isDir = node.type === "directory";
      const isExpanded = isDir && expandedDirs.has(node.path);
      const canExpand = isDir && (node.hasChildren || (Array.isArray(node.children) && node.children.length > 0));
      return (
        <React.Fragment key={node.path}>
          <div
            className={`file-tree-row ${isDir ? "is-dir" : "is-file"} ${openedFilePath === node.path ? "is-active" : ""}`}
            style={{ paddingLeft: `${8 + level * 14}px` }}
          >
            {isDir ? (
              <button
                type="button"
                className="file-tree-btn"
                onClick={() => toggleDir(node).catch(() => {})}
                title={node.path}
              >
                <span className={`tree-chevron ${isExpanded ? "is-open" : ""}`} aria-hidden="true">
                  {canExpand ? "▸" : "·"}
                </span>
                <span className="tree-icon is-folder" aria-hidden="true" />
                <span className="tree-name">{node.name}</span>
              </button>
            ) : (
              <button
                type="button"
                className="file-tree-btn"
                onClick={() => openFile(node.path)}
                title={node.path}
              >
                <span className="tree-chevron tree-leaf" aria-hidden="true">·</span>
                <span className="tree-icon is-file" aria-hidden="true" />
                <span className="tree-name">{node.name}</span>
              </button>
            )}
          </div>
          {isDir && isExpanded && Array.isArray(node.children) && node.children.length > 0 ? renderTreeNodes(node.children, level + 1) : null}
        </React.Fragment>
      );
    });

  return (
    <aside className={`session-sidebar${collapsed ? " is-collapsed" : ""}`}>
      <div className="session-sidebar-head">
        <button
          type="button"
          className="session-icon-btn"
          onClick={onToggleCollapse}
          title={collapsed ? "展开侧栏" : "收起侧栏"}
          aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M2.5 4h11M2.5 8h11M2.5 12h11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>

        {collapsed ? (
          <button
            type="button"
            className="session-icon-btn"
            onClick={onNewSession}
            disabled={disabled}
            title="新建对话"
            aria-label="新建对话"
          >
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
              <path d="M7.5 2v11M2 7.5h11" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"/>
            </svg>
          </button>
        ) : (
          <button
            type="button"
            className="session-new-chat-btn"
            onClick={onNewSession}
            disabled={disabled}
            title="新建对话"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
            <span>新建聊天</span>
          </button>
        )}
      </div>

      {collapsed ? (
        <div className="session-rail-tabs" role="tablist" aria-label="资源视图">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "sessions"}
            className={`session-rail-tab-btn ${activeTab === "sessions" ? "is-active" : ""}`}
            onClick={() => setActiveTab("sessions")}
            title="对话"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M3 4.5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v4.2a2 2 0 0 1-2 2H7l-2.8 2.6V10.7H5a2 2 0 0 1-2-2V4.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "files"}
            className={`session-rail-tab-btn ${activeTab === "files" ? "is-active" : ""}`}
            onClick={() => setActiveTab("files")}
            title="文件"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M3.3 3.2h3.2l1.1 1.4h5v6.8a1.4 1.4 0 0 1-1.4 1.4H4.7a1.4 1.4 0 0 1-1.4-1.4V4.6a1.4 1.4 0 0 1 1.4-1.4Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      ) : (
        <div className="session-list-wrap">
          <div className="session-tab-row" role="tablist" aria-label="资源视图">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "sessions"}
              className={`session-tab-btn ${activeTab === "sessions" ? "is-active" : ""}`}
              onClick={() => setActiveTab("sessions")}
            >
              对话
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "files"}
              className={`session-tab-btn ${activeTab === "files" ? "is-active" : ""}`}
              onClick={() => setActiveTab("files")}
            >
              文件
            </button>
          </div>

          {activeTab === "sessions" ? (
            sessionsLoading && sessions.length === 0 ? (
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
                    const isDeleting = s.id === deletingSessionId;
                    return (
                      <div key={s.id} className={`session-item-wrap ${isActive ? "is-active" : ""} ${isDeleting ? "is-deleting" : ""}`}>
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
                          onClick={(e) => { e.stopPropagation(); if (!isDeleting) onDeleteSession?.(s.id); }}
                          title={isDeleting ? "删除中..." : "删除对话"}
                          aria-label="删除对话"
                          disabled={isDeleting}
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
            )
          ) : (
            <div className="session-files-wrap">
              <div className="session-files-toolbar">
                <input
                  className="session-file-filter"
                  value={fileFilter}
                  onChange={(event) => setFileFilter(event.target.value)}
                  placeholder="筛选文件名或路径"
                />
                <button
                  type="button"
                  className="session-files-refresh-btn"
                  onClick={onRefreshFiles}
                  disabled={filesRefreshing}
                  title="刷新文件树"
                >
                  {filesRefreshing ? "刷新中..." : "刷新"}
                </button>
              </div>
              {searchMode ? (
                searchFiles.length === 0 ? (
                  <p className="session-empty">暂无匹配文件</p>
                ) : (
                  <ul className="file-search-list">
                    {searchFiles.map((file) => (
                      <li key={file.path}>
                        <button
                          type="button"
                          className={`file-search-item ${openedFilePath === file.path ? "is-active" : ""}`}
                          onClick={() => openFile(file.path)}
                          title={file.path}
                        >
                          <span className="file-search-name">{file.name}</span>
                          <span className="file-search-path">{file.path}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )
              ) : !Array.isArray(files) || files.length === 0 ? (
                <p className="session-empty">暂无匹配文件</p>
              ) : (
                <section className="file-tree-section">
                  <p className="recent-files-title">文件树</p>
                  <div className="file-tree">{renderTreeNodes(files)}</div>
                </section>
              )}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
