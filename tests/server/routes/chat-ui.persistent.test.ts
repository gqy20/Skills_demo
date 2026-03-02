import type { Request } from "express";
import { describe, expect, it, vi } from "vitest";
import type { RuntimeSettings } from "../../../src/server/types.js";

const { queryMock, createSessionMock, resumeSessionMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  createSessionMock: vi.fn(),
  resumeSessionMock: vi.fn()
}));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: queryMock,
  unstable_v2_createSession: createSessionMock,
  unstable_v2_resumeSession: resumeSessionMock
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

describe("handleChatUiRequest persistent path", () => {
  it("uses persistent session send/stream when runtime manager is provided", async () => {
    queryMock.mockReset();
    createSessionMock.mockReset();
    resumeSessionMock.mockReset();

    const fakeSession = {
      send: vi.fn(async () => undefined),
      stream: vi.fn(() =>
        streamFrom([
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
              delta: { type: "text_delta", text: "hello from persistent" }
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
        ])
      ),
      close: vi.fn()
    };
    createSessionMock.mockReturnValue(fakeSession);

    const runtime = { key: "ws1:s1", session: fakeSession };
    const sessionRuntimeManager = {
      acquireTurn: vi.fn(({ createSession }) => {
        createSession();
        return { runtime, created: true, acquired: true };
      }),
      get: vi.fn(() => runtime),
      endTurn: vi.fn(),
      close: vi.fn()
    };

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
    await handleChatUiRequest(req, res as never, {
      workspaceRegistry: { requireWorkspace: () => ({ id: "ws1", root: "/tmp/ws1", label: "ws1" }) } as never,
      defaultSettings,
      sessionMap,
      sessionSeedMap: new Map(),
      pendingStore: { createPendingRequest: vi.fn() } as never,
      sessionRuntimeManager: sessionRuntimeManager as never
    });

    expect(createSessionMock).toHaveBeenCalledOnce();
    const createArgs = createSessionMock.mock.calls[0]?.[0] || {};
    expect(typeof createArgs.canUseTool).toBe("function");
    expect(resumeSessionMock).not.toHaveBeenCalled();
    expect(queryMock).not.toHaveBeenCalled();
    expect(fakeSession.send).toHaveBeenCalledWith("hello");
    expect(fakeSession.stream).toHaveBeenCalledOnce();
    expect(sessionRuntimeManager.endTurn).toHaveBeenCalledWith("ws1:s1");
    expect(sessionMap.get("ws1:s1")).toBe("sdk-session-1");
    expect(res.end).toHaveBeenCalledOnce();
  });

  it("returns 500 when persistent session creation fails", async () => {
    queryMock.mockReset();
    createSessionMock.mockReset();
    resumeSessionMock.mockReset();

    createSessionMock.mockImplementation(() => {
      throw new Error("create failed");
    });

    const sessionRuntimeManager = {
      acquireTurn: vi.fn(({ createSession }) => {
        createSession();
        return { runtime: null, created: false, acquired: false };
      }),
      get: vi.fn(() => null),
      endTurn: vi.fn(),
      close: vi.fn()
    };

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
      pendingStore: { createPendingRequest: vi.fn() } as never,
      sessionRuntimeManager: sessionRuntimeManager as never
    });

    expect(createSessionMock).toHaveBeenCalledOnce();
    expect(queryMock).not.toHaveBeenCalled();
    expect(sessionRuntimeManager.endTurn).not.toHaveBeenCalled();
    expect(sessionMap.get("ws1:s2")).toBeUndefined();
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ ok: false, error: "create failed" });
    expect(res.end).not.toHaveBeenCalled();
  });
});
