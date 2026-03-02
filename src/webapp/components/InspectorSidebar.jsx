import { describeMcpProbe, resolveMcpServerState } from "../lib/chatUtils.js";

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
  onOpenSettings = () => {},
  sidebarSections,
  toggleSidebarSection,
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
  const probeInfo = describeMcpProbe(mcpCatalog.runtime);
  const mcpItems = Array.isArray(mcpCatalog.items) ? mcpCatalog.items : [];
  const mcpRows = mcpItems.map((item) => ({ item, state: resolveMcpServerState(item, mcpCatalog.mcpEnabled !== false) }));
  const mcpIssues = mcpRows.filter((row) => row.state.issue);
  const mcpConnected = mcpRows.filter((row) => row.state.kind === "connected");
  const mcpMissingEnv = mcpRows.filter((row) => row.state.kind === "missing_env");
  const mcpChecking = mcpRows.filter((row) => row.state.kind === "checking" || row.state.kind === "not_checked");

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
                <p className="session-tag">MCP 总览</p>
                <div className="session-toolbar-actions">
                  <button type="button" className="sidebar-mini-btn" onClick={reloadMcps} disabled={mcpCatalog.loading}>
                    {mcpCatalog.loading ? "刷新中..." : "刷新"}
                  </button>
                  <button type="button" className="sidebar-mini-btn" onClick={onOpenSettings}>
                    配置变量
                  </button>
                </div>
              </div>
              <div className="mcp-summary-chips">
                <span className="meta-chip">开关 {mcpCatalog.mcpEnabled ? "ON" : "OFF"}</span>
                <span className="meta-chip">在线 {mcpConnected.length}</span>
                <span className={`meta-chip ${mcpIssues.length > 0 ? "warn" : ""}`}>异常 {mcpIssues.length}</span>
                <span className={`meta-chip ${mcpMissingEnv.length > 0 ? "warn" : ""}`}>缺变量 {mcpMissingEnv.length}</span>
                <span className="meta-chip">待检测 {mcpChecking.length}</span>
              </div>
              <p className="session-tag">
                探针={probeInfo.probe} · 最近检测 {probeInfo.lastChecked}
              </p>
              {mcpCatalog.error && <p className="session-tag">加载失败：{mcpCatalog.error}</p>}
            </div>
            {mcpIssues.length > 0 && (
              <div className="mcp-issues">
                <p className="session-tag">待处理项（{mcpIssues.length}）</p>
                <ul className="mcps-list">
                  {mcpIssues.map(({ item, state }) => (
                    <li className="mcp-item mcp-item-issue" key={`issue-${item.name}`}>
                      <div className="mcp-head">
                        <p className="mcp-name">{item.name}</p>
                        <span className={`mcp-status ${state.className}`}>{state.label}</span>
                      </div>
                      {state.kind === "missing_env" && Array.isArray(item?.missingEnvVars) && item.missingEnvVars.length > 0 && (
                        <p className="mcp-error">缺少变量: {item.missingEnvVars.join(", ")}</p>
                      )}
                      {state.runtime?.error && <p className="mcp-error">错误: {state.runtime.error}</p>}
                      <div className="mcp-actions">
                        {state.kind === "missing_env" && (
                          <button type="button" className="sidebar-mini-btn" onClick={onOpenSettings}>
                            去补变量
                          </button>
                        )}
                        {(state.kind === "disconnected" || state.kind === "probe_failed" || state.kind === "unknown") && (
                          <button type="button" className="sidebar-mini-btn" onClick={reloadMcps}>
                            重试检测
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <ul className="mcps-list">
              {mcpRows.map(({ item, state }) => (
                <li className="mcp-item" key={item.name}>
                  <div className="mcp-head">
                    <p className="mcp-name">{item.name}</p>
                    <span className={`mcp-status ${state.className}`}>{state.label}</span>
                  </div>
                  <p className="mcp-meta">类型: {item.type || "unknown"}</p>
                  <details className="mcp-details">
                    <summary>查看详情</summary>
                    <div className="mcp-details-body">
                      {item.endpoint && <p className="mcp-endpoint">{item.endpoint}</p>}
                      {state.runtime?.status && <p className="mcp-meta">运行状态: {state.runtime.status}</p>}
                      {Array.isArray(item?.missingEnvVars) && item.missingEnvVars.length > 0 && (
                        <p className="mcp-error">缺少变量: {item.missingEnvVars.join(", ")}</p>
                      )}
                      {state.runtime?.error && <p className="mcp-error">错误: {state.runtime.error}</p>}
                    </div>
                  </details>
                </li>
              ))}
              {mcpItems.length === 0 && !mcpCatalog.loading && <li className="sessions-empty">未发现 MCP 配置</li>}
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
