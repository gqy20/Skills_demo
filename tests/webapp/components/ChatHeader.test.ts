import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ChatHeader from "../../../src/webapp/components/ChatHeader.jsx";

describe("ChatHeader", () => {
  it("renders runtime meta and control labels", () => {
    const html = renderToStaticMarkup(
      React.createElement(ChatHeader, {
        sidebarOpen: true,
        setSidebarOpen: vi.fn(),
        controlsOpen: true,
        setControlsOpen: vi.fn(),
        controlsRef: { current: null },
        settings: {
          hasToken: true,
          hasMineruKey: false,
          mcpEnabled: true,
          model: "glm-5",
          permissionProfile: "standard"
        },
        currentWorkspaceId: "ws-1",
        onOpenSettings: vi.fn(),
        onToggleMcp: vi.fn()
      })
    );

    expect(html).toContain("Agent Workspace");
    expect(html).toContain("Workspace: ws-1");
    expect(html).toContain("Model: glm-5");
    expect(html).toContain("API Key: 已配置");
    expect(html).toContain("MCP: ON");
    expect(html).toContain("权限: 标准");
  });

  it("shows sidebar button text when collapsed", () => {
    const html = renderToStaticMarkup(
      React.createElement(ChatHeader, {
        sidebarOpen: false,
        setSidebarOpen: vi.fn(),
        controlsOpen: false,
        setControlsOpen: vi.fn(),
        controlsRef: { current: null },
        settings: {
          hasToken: false,
          hasMineruKey: false,
          mcpEnabled: false,
          model: "",
          permissionProfile: "full_auto"
        },
        currentWorkspaceId: "",
        onOpenSettings: vi.fn(),
        onToggleMcp: vi.fn()
      })
    );

    expect(html).toContain("侧栏");
    expect(html).toContain("API Key: 未配置");
    expect(html).toContain("MCP: OFF");
    expect(html).toContain("权限: 全部允许");
  });
});
