import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ExecutionPanel from "../../../src/webapp/components/ExecutionPanel.jsx";

describe("ExecutionPanel", () => {
  it("shows waiting permission when blocked", () => {
    const html = renderToStaticMarkup(
      React.createElement(ExecutionPanel, {
        show: true,
        blockingPending: true,
        executionState: { phase: "queued", currentTool: "", toolElapsedSeconds: 0, actions: [] },
        silentSeconds: 0,
        isStreaming: false,
        settings: { permissionProfile: "standard" },
        mcpRuntimeStatus: { ok: null, count: 0, error: "" },
        showNoDeltaHint: false,
        onDismissNoDelta: vi.fn(),
        onForceStopAndRetry: vi.fn()
      })
    );
    expect(html).toContain("等待授权");
  });

  it("shows tool and retry hint", () => {
    const html = renderToStaticMarkup(
      React.createElement(ExecutionPanel, {
        show: true,
        blockingPending: false,
        executionState: {
          phase: "tool",
          currentTool: "paper.search",
          toolElapsedSeconds: 31,
          actions: ["step a"],
          dismissNoDelta: false
        },
        silentSeconds: 12,
        isStreaming: true,
        settings: { permissionProfile: "full_auto" },
        mcpRuntimeStatus: { ok: false, count: 0, error: "boom" },
        showNoDeltaHint: true,
        onDismissNoDelta: vi.fn(),
        onForceStopAndRetry: vi.fn()
      })
    );
    expect(html).toContain("工具执行中");
    expect(html).toContain("paper.search");
    expect(html).toContain("停止并重试");
    expect(html).toContain("MCP 异常");
  });
});
