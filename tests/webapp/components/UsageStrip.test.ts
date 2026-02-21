import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import UsageStrip from "../../../src/webapp/components/UsageStrip.jsx";

describe("UsageStrip", () => {
  it("renders collapsed usage entries", () => {
    const html = renderToStaticMarkup(
      React.createElement(UsageStrip, {
        skillUsageList: [{ name: "commander", count: 2 }],
        mcpUsageList: [{ key: "paper:search", details: { server: "paper", tool: "search" }, count: 1 }],
        usagePanelOpen: true,
        usageExpanded: { skills: false, mcps: false },
        setUsagePanelOpen: vi.fn(),
        setUsageExpanded: vi.fn()
      })
    );
    expect(html).toContain("运行摘要");
    expect(html).toContain("/commander");
    expect(html).toContain("paper::search");
  });

  it("returns null when no usage data", () => {
    const html = renderToStaticMarkup(
      React.createElement(UsageStrip, {
        skillUsageList: [],
        mcpUsageList: [],
        usagePanelOpen: false,
        usageExpanded: { skills: false, mcps: false },
        setUsagePanelOpen: vi.fn(),
        setUsageExpanded: vi.fn()
      })
    );
    expect(html).toBe("");
  });
});
