import type { Request } from "express";
import { describe, expect, it, vi } from "vitest";
import type { RuntimeSettings } from "../../../src/server/types.js";
import { handleChatUiRequest } from "../../../src/server/routes/chat-ui.js";

type MockRes = {
  statusCode: number;
  body: unknown;
  status: (code: number) => MockRes;
  json: (payload: unknown) => MockRes;
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
    }
  };
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
  it("returns 409 when session runtime is already running", async () => {
    const res = makeMockRes();
    const acquireTurn = vi.fn(() => ({
      runtime: { key: "ws1:s1" },
      created: false,
      acquired: false
    }));
    await handleChatUiRequest(
      {
        body: {
          id: "s1",
          messages: [{ role: "user", content: "hello" }]
        }
      } as Request,
      res as never,
      {
        workspaceRegistry: { requireWorkspace: () => ({ id: "ws1", root: "/tmp/ws1", label: "ws1" }) } as never,
        defaultSettings,
        sessionMap: new Map(),
        sessionSeedMap: new Map(),
        pendingStore: { createPendingRequest: vi.fn() } as never,
        sessionRuntimeManager: { acquireTurn, endTurn: vi.fn() } as never
      }
    );

    expect(acquireTurn).toHaveBeenCalledWith({
      workspaceId: "ws1",
      sessionId: "s1",
      createSession: expect.any(Function)
    });
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({
      ok: false,
      error: "session is busy",
      workspaceId: "ws1",
      id: "s1"
    });
  });
});
