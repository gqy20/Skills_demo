import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ChatMessageList from "../../../src/webapp/components/ChatMessageList.jsx";

describe("ChatMessageList", () => {
  it("renders user and assistant messages", () => {
    const html = renderToStaticMarkup(
      React.createElement(ChatMessageList, {
        messages: [
          { id: "u1", role: "user", parts: [{ type: "text", text: "hello" }] },
          { id: "a1", role: "assistant", parts: [{ type: "text", text: "world" }] }
        ],
        lastAssistantId: "a1",
        isStreaming: false,
        traceByAssistantId: {},
        onCopyText: vi.fn(),
        onRetryLast: vi.fn(),
        lastUserText: "hello"
      })
    );
    expect(html).toContain("hello");
    expect(html).toContain("world");
  });

  it("shows unverified tool warning when no trace", () => {
    const html = renderToStaticMarkup(
      React.createElement(ChatMessageList, {
        messages: [{ id: "a1", role: "assistant", parts: [{ type: "text", text: "已调用工具并保存到文件" }] }],
        lastAssistantId: "a1",
        isStreaming: false,
        traceByAssistantId: {},
        onCopyText: vi.fn(),
        onRetryLast: vi.fn(),
        lastUserText: "q"
      })
    );
    expect(html).toContain("未检测到真实工具事件");
  });

  it("shows fallback card when assistant message has no visible text", () => {
    const html = renderToStaticMarkup(
      React.createElement(ChatMessageList, {
        messages: [{ id: "a1", role: "assistant", parts: [{ type: "text", text: "" }] }],
        lastAssistantId: "a1",
        isStreaming: false,
        traceByAssistantId: {},
        onCopyText: vi.fn(),
        onRetryLast: vi.fn(),
        lastUserText: "你好"
      })
    );
    expect(html).toContain("未收到文本输出");
  });
});
