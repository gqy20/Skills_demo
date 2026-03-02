import type { Request } from "express";
import { describe, expect, it, vi } from "vitest";
import type { RuntimeSettings } from "../../../src/server/types.js";

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn()
}));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: queryMock
}));

type MockRes = {
  statusCode: number;
  body: unknown;
  status: (code: number) => MockRes;
  json: (payload: unknown) => MockRes;
  setHeader: ReturnType<typeof vi.fn>;
  flushHeaders: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
};

function makeMockRes(): MockRes {
  return {
    statusCode: 200,
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn(() => true),
    end: vi.fn()
  };
}

const defaultSettings: RuntimeSettings = {
  model: "m1",
  baseUrl: "https://example.com",
  authToken: "token",
  runtimeEnv: {},
  permissionProfile: "standard",
  mcpEnabled: true,
  speedModeEnabled: false,
  toolGateEnabled: true,
  debugEnabled: false,
  debugSseEnabled: false
};

function streamFrom(events: Array<Record<string, unknown>>) {
  return (async function* () {
    for (const event of events) yield event;
  })();
}

describe("handleChatUiRequest query path", () => {
  it("uses query send/stream with canUseTool handler", async () => {
    queryMock.mockReset();

    const close = vi.fn();
    queryMock.mockImplementation(({ options }) => {
      expect(typeof options?.canUseTool).toBe("function");
      const eventStream = streamFrom([
        {
          type: "system",
          subtype: "init",
          model: "m1",
          permissionMode: "default",
          tools: [],
          session_id: "sdk-session-1"
        },
        {
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: { type: "text_delta", text: "hello from query" }
          },
          session_id: "sdk-session-1"
        },
        {
          type: "result",
          subtype: "success",
          result: "",
          is_error: false,
          stop_reason: null,
          session_id: "sdk-session-1"
        }
      ]);
      return Object.assign(eventStream, { close });
    });

    const [{ handleChatUiRequest }] = await Promise.all([import("../../../src/server/routes/chat-ui.js")]);
    const req = {
      body: {
        id: "s1",
        messages: [{ role: "user", content: "hello" }]
      },
      on: vi.fn()
    } as unknown as Request;
    const res = makeMockRes();
    const sessionMap = new Map<string, string>();
    const endTurn = vi.fn();
    await handleChatUiRequest(req, res as never, {
      workspaceRegistry: { requireWorkspace: () => ({ id: "ws1", root: "/tmp/ws1", label: "ws1" }) } as never,
      defaultSettings,
      sessionMap,
      sessionSeedMap: new Map(),
      pendingStore: { createPendingRequest: vi.fn() } as never,
      sessionRuntimeManager: { endTurn } as never
    });

    expect(queryMock).toHaveBeenCalledOnce();
    expect(endTurn).not.toHaveBeenCalled();
    expect(sessionMap.get("ws1:s1")).toBe("sdk-session-1");
    expect(res.end).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it("returns 500 when query creation fails", async () => {
    queryMock.mockReset();
    queryMock.mockImplementation(() => {
      throw new Error("create failed");
    });

    const [{ handleChatUiRequest }] = await Promise.all([import("../../../src/server/routes/chat-ui.js")]);
    const req = {
      body: {
        id: "s2",
        messages: [{ role: "user", content: "hello fallback" }]
      },
      on: vi.fn()
    } as unknown as Request;
    const res = makeMockRes();
    const sessionMap = new Map<string, string>();
    await handleChatUiRequest(req, res as never, {
      workspaceRegistry: { requireWorkspace: () => ({ id: "ws1", root: "/tmp/ws1", label: "ws1" }) } as never,
      defaultSettings,
      sessionMap,
      sessionSeedMap: new Map(),
      pendingStore: { createPendingRequest: vi.fn() } as never
    });

    expect(queryMock).toHaveBeenCalledOnce();
    expect(sessionMap.get("ws1:s2")).toBeUndefined();
    expect(res.end).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(200);
    expect(res.body).toBeNull();
  });
});
