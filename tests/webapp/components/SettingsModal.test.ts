import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import SettingsModal from "../../../src/webapp/components/SettingsModal.jsx";

const baseSettings = {
  model: "glm-5",
  baseUrl: "https://example.com",
  authToken: "",
  hasToken: true,
  tokenPreview: "abcd...wxyz",
  runtimeEnvText: "",
  permissionProfile: "standard",
  mcpEnabled: true,
  speedModeEnabled: false,
  toolGateEnabled: true,
  debugEnabled: false,
  debugSseEnabled: false
};

describe("SettingsModal", () => {
  it("renders hidden class when closed", () => {
    const html = renderToStaticMarkup(
      React.createElement(SettingsModal, {
        open: false,
        settings: baseSettings,
        setSettings: vi.fn(),
        mcpCatalog: { items: [] },
        onClose: vi.fn(),
        onSave: vi.fn(async () => {}),
        onSyncDotenv: vi.fn(async () => {})
      })
    );
    expect(html).toContain("modal hidden");
  });

  it("shows full_auto warning", () => {
    const html = renderToStaticMarkup(
      React.createElement(SettingsModal, {
        open: true,
        settings: { ...baseSettings, permissionProfile: "full_auto" },
        setSettings: vi.fn(),
        mcpCatalog: {
          items: [{ name: "demo", requiredEnvVars: ["NOTION_TOKEN", "ZOTERO_API_KEY"] }]
        },
        onClose: vi.fn(),
        onSave: vi.fn(async () => {}),
        onSyncDotenv: vi.fn(async () => {})
      })
    );
    expect(html).toContain("全部允许（高风险）");
    expect(html).toContain("该模式会跳过权限审批");
    expect(html).toContain("检测到 .mcp.json 所需环境变量");
    expect(html).toContain("NOTION_TOKEN");
  });
});
