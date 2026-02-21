import React from "react";
import { permissionProfileLabel } from "../lib/chatUtils.js";

export default function ChatHeader({
  sidebarOpen,
  setSidebarOpen,
  controlsOpen,
  setControlsOpen,
  controlsRef,
  settings,
  currentWorkspaceId,
  onOpenSettings,
  onToggleMcp
}) {
  return (
    <header className="chat-head">
      <div className="chat-head-row">
        <h1>Agent Workspace</h1>
        <div className="head-actions" ref={controlsRef}>
          <button className="btn-secondary" type="button" onClick={() => setSidebarOpen((v) => !v)}>
            {sidebarOpen ? "隐藏侧栏" : "侧栏"}
          </button>
          <button className="btn-secondary" type="button" onClick={() => setControlsOpen((v) => !v)}>
            控制
          </button>
          <div className={`controls-popover ${controlsOpen ? "" : "hidden"}`}>
            <button className={`btn-secondary ${settings.hasToken ? "" : "is-off"}`} type="button" onClick={onOpenSettings}>
              API Key: {settings.hasToken ? "已配置" : "未配置"}
            </button>
            <button className={`btn-secondary ${settings.hasMineruKey ? "" : "is-off"}`} type="button" onClick={onOpenSettings}>
              MinerU: {settings.hasMineruKey ? "已配置" : "未配置"}
            </button>
            <button className={`btn-secondary ${settings.mcpEnabled ? "" : "is-off"}`} type="button" onClick={onToggleMcp}>
              MCP: {settings.mcpEnabled ? "ON" : "OFF"}
            </button>
            <button className="btn-secondary" type="button" onClick={onOpenSettings}>
              权限: {permissionProfileLabel(settings.permissionProfile)}
            </button>
          </div>
        </div>
      </div>
      <div className="runtime-meta">
        <span className="meta-chip">Workspace: {currentWorkspaceId || "-"}</span>
        <span className="meta-chip">Model: {settings.model || "-"}</span>
        <span className="meta-chip">权限: {permissionProfileLabel(settings.permissionProfile)}</span>
      </div>
    </header>
  );
}
