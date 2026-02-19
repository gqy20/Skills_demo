import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { registerChatRoutes } from "../../../src/server/routes/chat.js";
import type { RuntimeSettings } from "../../../src/server/types.js";

type Handler = (req: Request, res: Response) => void | Promise<void>;

type MockRes = Response & {
  statusCode: number;
  body: unknown;
};

const defaultSettings: RuntimeSettings = {
  model: "m1",
  baseUrl: "https://example.com",
  authToken: "",
  mineruApiKey: "",
  permissionProfile: "standard",
  mcpEnabled: true,
  speedModeEnabled: false,
  toolGateEnabled: true,
  debugEnabled: false,
  debugSseEnabled: false
};

function makeMockRes(): MockRes {
  let statusCode = 200;
  let body: unknown = null;
  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(data: unknown) {
      body = data;
      return this;
    },
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body;
    }
  };
  return res as unknown as MockRes;
}

function registerRoutes() {
  const posts = new Map<string, Handler>();
  const app = {
    post(route: string, handler: Handler) {
      posts.set(route, handler);
    }
  };
  const workspaceRegistry = {
    requireWorkspace: vi.fn(() => ({ id: "ws1", root: "/tmp/ws1", label: "ws1" }))
  };
  registerChatRoutes({
    app: app as never,
    workspaceRegistry: workspaceRegistry as never,
    pendingStore: { createPendingRequest: vi.fn() } as never,
    defaultSettings,
    sessionMap: new Map(),
    sessionSeedMap: new Map(),
    activeQueries: new Map()
  });
  return { posts, workspaceRegistry };
}

describe("registerChatRoutes", () => {
  it("returns 400 for /api/chat/ui when user message is missing", async () => {
    const { posts } = registerRoutes();
    const handler = posts.get("/api/chat/ui");
    const req = { body: { id: "s1", messages: [{ role: "assistant", content: "x" }] } } as Request;
    const res = makeMockRes();
    await handler!(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "user message is required" });
  });

  it("returns 400 for /api/chat/stop when id is missing", async () => {
    const { posts } = registerRoutes();
    const handler = posts.get("/api/chat/stop");
    const req = { body: {} } as Request;
    const res = makeMockRes();
    await handler!(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "id is required" });
  });

  it("returns stopped=false when no active query exists", async () => {
    const { posts } = registerRoutes();
    const handler = posts.get("/api/chat/stop");
    const req = { body: { id: "session-a" } } as Request;
    const res = makeMockRes();
    await handler!(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      workspaceId: "ws1",
      id: "session-a",
      stopped: false,
      reason: "no_active_query"
    });
  });

  it("interrupts and closes active query for /api/chat/stop", async () => {
    const posts = new Map<string, Handler>();
    const app = {
      post(route: string, handler: Handler) {
        posts.set(route, handler);
      }
    };
    const activeQuery = {
      interrupt: vi.fn(async () => undefined),
      close: vi.fn()
    };
    const activeQueries = new Map<string, unknown>([["ws1:session-a", activeQuery]]);
    registerChatRoutes({
      app: app as never,
      workspaceRegistry: { requireWorkspace: () => ({ id: "ws1", root: "/tmp/ws1", label: "ws1" }) } as never,
      pendingStore: { createPendingRequest: vi.fn() } as never,
      defaultSettings,
      sessionMap: new Map(),
      sessionSeedMap: new Map(),
      activeQueries: activeQueries as never
    });

    const handler = posts.get("/api/chat/stop");
    const req = { body: { id: "session-a" } } as Request;
    const res = makeMockRes();
    await handler!(req, res);

    expect(activeQuery.interrupt).toHaveBeenCalledOnce();
    expect(activeQuery.close).toHaveBeenCalledOnce();
    expect(activeQueries.has("ws1:session-a")).toBe(false);
    expect(res.body).toEqual({ ok: true, workspaceId: "ws1", id: "session-a", stopped: true });
  });
});
