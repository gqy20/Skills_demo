import React from "react";
import { permissionProfileLabel } from "../lib/chatUtils.js";

export default function ChatHeader({
  sidebarOpen,
  setSidebarOpen,
  settings,
  currentWorkspaceId,
  onOpenSettings,
  onToggleMcp
}) {
  return (
    <header className="chat-head">
      <div className="chat-head-row">
        <h1>AI Workspace</h1>
        <div className="head-actions">
          <button className="btn-secondary" type="button" onClick={() => setSidebarOpen((v) => !v)}>
            {sidebarOpen ? "隐藏侧栏" : "侧栏"}
          </button>
          <button className={`btn-secondary btn-mcp ${settings.mcpEnabled ? "is-mcp-on" : "is-off"}`} type="button" onClick={onToggleMcp}>
            <span className={`mcp-dot ${settings.mcpEnabled ? "is-on" : ""}`} />
            MCP {settings.mcpEnabled ? "ON" : "OFF"}
          </button>
          <button className="btn-secondary" type="button" onClick={onOpenSettings}>
            设置
          </button>
        </div>
      </div>
      <div className="runtime-meta">
        <span className="meta-chip">Workspace: {currentWorkspaceId || "-"}</span>
        <span className="meta-chip">Model: {settings.model || "-"}</span>
        <span className="meta-chip">Key: {settings.hasToken ? "已配置" : "未配置"}</span>
        <span className="meta-chip">权限: {permissionProfileLabel(settings.permissionProfile)}</span>
      </div>
    </header>
  );
}
