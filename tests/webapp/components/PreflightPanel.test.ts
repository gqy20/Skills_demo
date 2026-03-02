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
          { title: "A", text: "Prompt A", desc: "Desc A", icon: "A+" },
          { title: "B", text: "Prompt B", desc: "Desc B", icon: "B+" }
        ],
        onSubmitPrompt: vi.fn()
      })
    );
    expect(html).toContain("有什么可以帮你研究的？");
    expect(html).toContain("选择下方模板快速开始");
    expect(html).toContain("Desc A");
    expect(html).toContain("开始 →");
  });

  it("returns null when hidden", () => {
    const html = renderToStaticMarkup(
      React.createElement(PreflightPanel, {
        show: false,
        quickPrompts: [],
        onSubmitPrompt: vi.fn()
      })
    );
    expect(html).toBe("");
  });
});
