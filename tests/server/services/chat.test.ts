import { describe, expect, it, vi } from "vitest";
import {
  extractDeltaText,
  extractPrompt,
  extractResultText,
  extractSdkLifecycle,
  writeSseData,
  writeSseDone
} from "../../../src/server/services/chat.js";

describe("chat service helpers", () => {
  it("extracts prompt from the latest user text part", () => {
    const prompt = extractPrompt([
      { role: "user", parts: [{ type: "text", text: "first" }] },
      { role: "assistant", parts: [{ type: "text", text: "ignore" }] },
      { role: "user", parts: [{ type: "text", text: "latest" }] }
    ]);
    expect(prompt).toBe("latest");
  });

  it("falls back to user content object when parts are missing", () => {
    const prompt = extractPrompt([
      { role: "user", content: { message: "from content" } }
    ]);
    expect(prompt).toBe("from content");
  });

  it("extracts text delta only for text content_block_delta events", () => {
    expect(
      extractDeltaText({
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "text_delta", text: "abc" } }
      } as never)
    ).toBe("abc");
    expect(extractDeltaText({ type: "result", subtype: "success" } as never)).toBe("");
  });

  it("extracts result text only for successful result events", () => {
    expect(extractResultText({ type: "result", subtype: "success", result: "done" } as never)).toBe("done");
    expect(extractResultText({ type: "result", subtype: "error", result: "bad" } as never)).toBe("");
  });

  it("normalizes sdk lifecycle events", () => {
    expect(extractSdkLifecycle({ type: "system", subtype: "init" } as never)).toEqual({
      category: "system",
      subtype: "init"
    });
    expect(
      extractSdkLifecycle({
        type: "tool_progress",
        tool_name: "bash",
        tool_use_id: "u1",
        elapsed_time_seconds: 1.2
      } as never)
    ).toEqual({
      category: "tool_progress",
      toolName: "bash",
      toolUseId: "u1",
      elapsedSeconds: 1.2
    });
    expect(
      extractSdkLifecycle({
        type: "system",
        subtype: "hook_response",
        hook_id: "h1",
        hook_name: "update-status.sh",
        hook_event: "PostToolUse",
        outcome: "success",
        exit_code: 0
      } as never)
    ).toEqual({
      category: "hook_response",
      hookId: "h1",
      hookName: "update-status.sh",
      hookEvent: "PostToolUse",
      outcome: "success",
      exitCode: 0
    });
  });

  it("writes SSE frames", () => {
    const write = vi.fn();
    const res = { write } as never;
    writeSseData(res, { ok: true });
    writeSseDone(res);
    expect(write).toHaveBeenNthCalledWith(1, 'data: {"ok":true}\n\n');
    expect(write).toHaveBeenNthCalledWith(2, "data: [DONE]\n\n");
  });
});
