import { describeMcpProbe } from "../lib/chatUtils.js";

export default function InspectorSidebar({
  sidebarOpen,
  currentWorkspaceId,
  setCurrentWorkspaceId,
  workspaces,
  skills,
  filteredSkills,
  skillFilter,
  setSkillFilter,
  skillSourceTab,
  setSkillSourceTab,
  skillSourceCounts,
  skillExpanded,
  setSkillExpanded,
  mcpCatalog,
  reloadMcps,
  sidebarSections,
  toggleSidebarSection,
  sessions,
  sessionsLoading,
  sessionsError,
  openingSessionId,
  openSession,
  startNewSession,
  reloadSessions,
  currentSessionId,
  files,
  filteredFiles,
  fileFilter,
  setFileFilter,
  openFile,
  openedFilePath,
  pendingState,
  blockingPending,
  diagnostics,
  settings,
  events
}) {
  const formatSessionTime = (ts) => {
    const n = Number(ts || 0);
    if (!Number.isFinite(n) || n <= 0) return "";
    const d = new Date(n);
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    if (sameDay) {
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString([], { month: "2-digit", day: "2-digit" });
  };

  const probeInfo = describeMcpProbe(mcpCatalog.runtime);

  return (
    <aside className={`inspector ${sidebarOpen ? "" : "hidden"}`}>
      <section className="panel">
        <h2>Workspace</h2>
        <select value={currentWorkspaceId} onChange={(event) => setCurrentWorkspaceId(event.target.value)}>
          {workspaces.map((ws) => (
            <option key={ws.id} value={ws.id}>
              {ws.id}
            </option>
          ))}
        </select>
        <p className="session-tag">{workspaces.find((ws) => ws.id === currentWorkspaceId)?.root || ""}</p>
      </section>

      <section className="panel">
        <h2>Skills</h2>
        <div className="panel-toolbar">
          <p className="session-tag">仅显示用户/项目 skills，共 {skills.length} 个</p>
          <input
            className="panel-filter-input"
            value={skillFilter}
            onChange={(event) => setSkillFilter(event.target.value)}
            placeholder="筛选 skills"
          />
          <div className="skills-tabs" role="tablist" aria-label="skills source">
            <button
              type="button"
              className={`skills-tab ${skillSourceTab === "all" ? "is-active" : ""}`}
              onClick={() => setSkillSourceTab("all")}
            >
              全部 {skillSourceCounts.all}
            </button>
            <button
              type="button"
              className={`skills-tab ${skillSourceTab === "project" ? "is-active" : ""}`}
              onClick={() => setSkillSourceTab("project")}
            >
              project {skillSourceCounts.project}
            </button>
            <button
              type="button"
              className={`skills-tab ${skillSourceTab === "user" ? "is-active" : ""}`}
              onClick={() => setSkillSourceTab("user")}
            >
              user {skillSourceCounts.user}
            </button>
          </div>
        </div>
        <ul className="skills-list">
          {filteredSkills.map((item) => {
            const expanded = skillExpanded[item.name] === true;
            return (
              <li className="skills-item" key={item.name}>
                <div className="skills-head">
                  <p className="skills-name">/{item.name}</p>
                  <span className="skills-source">{item.source}</span>
                </div>
                <p className={`skills-desc ${expanded ? "is-expanded" : ""}`}>{item.description || "无描述"}</p>
                {item.description && item.description.length > 72 && (
                  <button
                    type="button"
                    className="skills-toggle"
                    onClick={() => setSkillExpanded((prev) => ({ ...prev, [item.name]: !expanded }))}
                  >
                    {expanded ? "收起" : "展开"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="panel panel-collapsible">
        <button type="button" className="panel-collapse-btn" onClick={() => toggleSidebarSection("mcps")}>
          <h2>MCP Servers</h2>
          <span>{sidebarSections.mcps ? "收起" : "展开"}</span>
        </button>
        {sidebarSections.mcps && (
          <>
            <div className="panel-toolbar">
              <div className="session-toolbar-row">
                <p className="session-tag">
                  开关={mcpCatalog.mcpEnabled ? "ON" : "OFF"} · 数量={mcpCatalog.items.length}
                </p>
                <button type="button" className="sidebar-mini-btn" onClick={reloadMcps} disabled={mcpCatalog.loading}>
                  {mcpCatalog.loading ? "刷新中..." : "刷新"}
                </button>
              </div>
              <p className="session-tag">
                探针={probeInfo.probe} · 最近检测 {probeInfo.lastChecked}
              </p>
              {mcpCatalog.error && <p className="session-tag">加载失败：{mcpCatalog.error}</p>}
            </div>
            <ul className="mcps-list">
              {mcpCatalog.items.map((item) => {
                const runtime = item?.runtime || null;
                const runtimeStatus = String(runtime?.status || "");
                const status =
                  !mcpCatalog.mcpEnabled || runtimeStatus === "disabled"
                    ? "全局关闭"
                    : runtimeStatus === "missing_env"
                      ? "缺少环境变量"
                    : runtimeStatus === "probe_failed"
                        ? "探针失败"
                      : runtimeStatus === "checking"
                        ? "检测中"
                        : runtime?.connected === true || runtimeStatus === "connected"
                          ? "在线"
                          : runtime?.connected === false || runtimeStatus === "disconnected"
                            ? "离线"
                            : runtimeStatus === "not_checked"
                              ? "待检测"
                              : "未知";
                const statusClass =
                  status === "在线"
                    ? "mcp-status-ok"
                    : status === "离线" || status === "全局关闭" || status === "缺少环境变量" || status === "探针失败"
                      ? "mcp-status-off"
                      : "mcp-status-unknown";
                return (
                  <li className="mcp-item" key={item.name}>
                    <div className="mcp-head">
                      <p className="mcp-name">{item.name}</p>
                      <span className={`mcp-status ${statusClass}`}>{status}</span>
                    </div>
                    <p className="mcp-meta">
                      类型: {item.type || "unknown"}
                      {runtime?.status ? ` · ${runtime.status}` : ""}
                    </p>
                    {item.endpoint && <p className="mcp-endpoint">{item.endpoint}</p>}
                    {Array.isArray(item?.missingEnvVars) && item.missingEnvVars.length > 0 && (
                      <p className="mcp-error">缺少变量: {item.missingEnvVars.join(", ")}</p>
                    )}
                    {runtime?.error && <p className="mcp-error">错误: {runtime.error}</p>}
                  </li>
                );
              })}
              {mcpCatalog.items.length === 0 && !mcpCatalog.loading && <li className="sessions-empty">未发现 MCP 配置</li>}
            </ul>
          </>
        )}
      </section>

      <section className="panel panel-collapsible">
        <button type="button" className="panel-collapse-btn" onClick={() => toggleSidebarSection("sessions")}>
          <h2>历史会话</h2>
          <span>{sidebarSections.sessions ? "收起" : "展开"}</span>
        </button>
        {sidebarSections.sessions && (
          <>
            <div className="panel-toolbar">
              <div className="session-toolbar-row">
                <p className="session-tag">共 {sessions.length} 条</p>
                <div className="session-toolbar-actions">
                  <button type="button" className="sidebar-mini-btn" onClick={reloadSessions} disabled={sessionsLoading}>
                    刷新
                  </button>
                  <button type="button" className="sidebar-mini-btn" onClick={startNewSession}>
                    新会话
                  </button>
                </div>
              </div>
            </div>
            <ul className="sessions-list">
              {sessionsLoading && <li className="sessions-empty">正在加载...</li>}
              {!sessionsLoading && sessionsError && <li className="sessions-empty">加载失败：{sessionsError}</li>}
              {!sessionsLoading &&
                sessions.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={`session-item-btn ${currentSessionId === item.id ? "is-active" : ""}`}
                      onClick={() => openSession(item.id)}
                      disabled={openingSessionId === item.id}
                    >
                      <strong>{item.title || "未命名会话"}</strong>
                      <em>
                        {formatSessionTime(item.updatedAt)} · {Math.max(0, Math.floor((item.messageCount || 0) / 2))} 轮
                        {openingSessionId === item.id ? " · 加载中..." : ""}
                      </em>
                      <span>{item.lastPreview || "暂无摘要"}</span>
                    </button>
                  </li>
                ))}
              {!sessionsLoading && sessions.length === 0 && <li className="sessions-empty">暂无历史会话</li>}
            </ul>
          </>
        )}
      </section>

      <section className="panel panel-collapsible">
        <button type="button" className="panel-collapse-btn" onClick={() => toggleSidebarSection("files")}>
          <h2>Files</h2>
          <span>{sidebarSections.files ? "收起" : "展开"}</span>
        </button>
        {sidebarSections.files && (
          <>
            <div className="panel-toolbar">
              <p className="session-tag">工作区文件 {files.length} 项</p>
              <input
                className="panel-filter-input"
                value={fileFilter}
                onChange={(event) => setFileFilter(event.target.value)}
                placeholder="筛选文件"
              />
            </div>
            <ul className="files-list">
              {filteredFiles.map((file) => (
                <li key={file.path}>
                  {file.type === "file" ? (
                    <button
                      type="button"
                      className={`file-item-btn ${openedFilePath === file.path ? "is-active" : ""}`}
                      onClick={() => openFile(file.path)}
                    >
                      <span className="files-name" style={{ paddingLeft: `${(file.level || 0) * 14}px` }}>
                        · {file.name}
                      </span>
                    </button>
                  ) : (
                    <span className="files-name files-dir" style={{ paddingLeft: `${(file.level || 0) * 14}px` }}>
                      ▸ {file.name}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="panel panel-collapsible">
        <button type="button" className="panel-collapse-btn" onClick={() => toggleSidebarSection("pending")}>
          <h2>Pending Input</h2>
          <span>{sidebarSections.pending ? "收起" : "展开"}</span>
        </button>
        {sidebarSections.pending && (
          <div className="pending-summary">
            <p>
              <strong>队列:</strong> {pendingState.order.length}
            </p>
            <p>
              <strong>当前状态:</strong> {blockingPending ? "等待你的输入" : "空闲"}
            </p>
            <p className="hint">
              权限={settings.permissionProfile || "standard"} · Gate={diagnostics.toolGateEnabled ? "ON" : "OFF"} · Hits=
              {diagnostics.gateHits} · Ask={diagnostics.askCreated}/{diagnostics.askResolved}
            </p>
          </div>
        )}
      </section>

      {settings.debugEnabled && (
        <section className="panel panel-collapsible panel-events">
          <button type="button" className="panel-collapse-btn" onClick={() => toggleSidebarSection("events")}>
            <h2>Events</h2>
            <span>{sidebarSections.events ? "收起" : "展开"}</span>
          </button>
          {sidebarSections.events && <pre className="output">{JSON.stringify(events, null, 2)}</pre>}
        </section>
      )}
    </aside>
  );
}
