import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import PreflightPanel from "../../../src/webapp/components/PreflightPanel.jsx";

describe("PreflightPanel", () => {
  it("renders quick prompts and chips", () => {
    const html = renderToStaticMarkup(
      React.createElement(PreflightPanel, {
        show: true,
        quickPrompts: [
          { title: "A", text: "Prompt A" },
          { title: "B", text: "Prompt B" }
        ],
        quickChips: ["c1", "c2"],
        onSubmitPrompt: vi.fn(),
        onSelectChip: vi.fn()
      })
    );
    expect(html).toContain("开始你的科研任务");
    expect(html).toContain("Prompt A");
    expect(html).toContain("c1");
  });

  it("returns null when hidden", () => {
    const html = renderToStaticMarkup(
      React.createElement(PreflightPanel, {
        show: false,
        quickPrompts: [],
        quickChips: [],
        onSubmitPrompt: vi.fn(),
        onSelectChip: vi.fn()
      })
    );
    expect(html).toBe("");
  });
});
