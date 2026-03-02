import { describe, expect, it } from "vitest";
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
        hookTimeline: [],
        showNoDeltaHint: false
      })
    );
    expect(html).toContain("等待授权");
  });

  it("shows compact sticky status line", () => {
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
        hookTimeline: [{ stage: "hook_started", at: Date.now(), hookEvent: "PostToolUse", hookName: "update-status.sh" }],
        showHookTimeline: true,
        showNoDeltaHint: true,
      })
    );
    expect(html).toContain("工具执行中");
    expect(html).toContain("paper.search");
    expect(html).toContain("等待工具/上游返回");
    expect(html).toContain("MCP 检测中");
    expect(html).toContain("展开详情");
  });

  it("shows non-blocking warning for mcp timeout", () => {
    const html = renderToStaticMarkup(
      React.createElement(ExecutionPanel, {
        show: true,
        blockingPending: false,
        executionState: { phase: "tool", currentTool: "", toolElapsedSeconds: 0, actions: [] },
        silentSeconds: 0,
        isStreaming: true,
        settings: { permissionProfile: "full_auto" },
        mcpRuntimeStatus: { ok: false, count: 0, error: "mcpServerStatus timed out after 10000ms", status: "timeout" },
        mcpProbeRuntime: { ok: false, error: "mcpServerStatus timed out after 10000ms", checking: false },
        hookTimeline: [],
        showNoDeltaHint: false,
      })
    );
    expect(html).toContain("MCP 超时（不阻断）");
  });

  it("shows mcp checking state", () => {
    const html = renderToStaticMarkup(
      React.createElement(ExecutionPanel, {
        show: true,
        blockingPending: false,
        executionState: { phase: "queued", currentTool: "", toolElapsedSeconds: 0, actions: [] },
        silentSeconds: 0,
        isStreaming: true,
        settings: { permissionProfile: "full_auto" },
        mcpRuntimeStatus: { ok: null, count: 0, error: "", status: "checking" },
        mcpProbeRuntime: { ok: null, error: "", checking: true },
        hookTimeline: [],
        showNoDeltaHint: false,
      })
    );
    expect(html).toContain("MCP 检测中");
  });
});
