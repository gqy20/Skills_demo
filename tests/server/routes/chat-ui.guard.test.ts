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

function streamFrom(events: Array<Record<string, unknown>>) {
  return (async function* () {
    for (const event of events) yield event;
  })();
}

const defaultSettings: RuntimeSettings = {
  model: "m1",
  baseUrl: "https://example.com",
  authToken: "",
  runtimeEnv: {},
  permissionProfile: "standard",
  mcpEnabled: true,
  speedModeEnabled: false,
  toolGateEnabled: true,
  debugEnabled: false,
  debugSseEnabled: false
};

describe("handleChatUiRequest guard", () => {
  it("ignores session runtime lock and serves via query stream", async () => {
    queryMock.mockReset();
    queryMock.mockImplementation(() => {
      const eventStream = streamFrom([
        { type: "system", subtype: "init", model: "m1", permissionMode: "default", tools: [], session_id: "sdk-session-1" },
        { type: "result", subtype: "success", result: "ok", is_error: false, stop_reason: null, session_id: "sdk-session-1" }
      ]);
      return Object.assign(eventStream, { close: vi.fn() });
    });

    const acquireTurn = vi.fn(() => ({
      runtime: { key: "ws1:s1" },
      created: false,
      acquired: false
    }));

    const [{ handleChatUiRequest }] = await Promise.all([import("../../../src/server/routes/chat-ui.js")]);
    const req = {
      body: {
        id: "s1",
        messages: [{ role: "user", content: "hello" }]
      },
      on: vi.fn()
    } as unknown as Request;
    const res = makeMockRes();
    await handleChatUiRequest(req, res as never, {
      workspaceRegistry: { requireWorkspace: () => ({ id: "ws1", root: "/tmp/ws1", label: "ws1" }) } as never,
      defaultSettings,
      sessionMap: new Map(),
      sessionSeedMap: new Map(),
      pendingStore: { createPendingRequest: vi.fn() } as never,
      sessionRuntimeManager: { acquireTurn, endTurn: vi.fn() } as never
    });

    expect(acquireTurn).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(queryMock).toHaveBeenCalledOnce();
    expect(res.end).toHaveBeenCalledOnce();
  });
});
