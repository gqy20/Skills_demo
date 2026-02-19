import type { Request, Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceRegistry } from "../../../src/server/services/workspaces.js";
import type { RuntimeSettings } from "../../../src/server/types.js";

type Handler = (req: Request, res: Response) => void | Promise<void>;
type MockRes = Response & { statusCode: number; body: unknown };

const { fetchSkillsMock } = vi.hoisted(() => ({
  fetchSkillsMock: vi.fn()
}));

vi.mock("../../../src/server/services/skills.js", () => ({
  fetchSkills: fetchSkillsMock
}));

const defaults: RuntimeSettings = {
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
const ORIGINAL_WORKSPACE_ROOT = process.env.AGENT_WORKSPACE_ROOT;
const ORIGINAL_WORKSPACES = process.env.AGENT_WORKSPACES;

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
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body;
    }
  };
  return res as unknown as MockRes;
}

function makeApp() {
  const gets = new Map<string, Handler>();
  return {
    app: {
      get(route: string, handler: Handler) {
        gets.set(route, handler);
      },
      post() {},
      put() {}
    },
    gets
  };
}

describe("/api/skills route", () => {
  afterEach(() => {
    if (ORIGINAL_WORKSPACE_ROOT === undefined) delete process.env.AGENT_WORKSPACE_ROOT;
    else process.env.AGENT_WORKSPACE_ROOT = ORIGINAL_WORKSPACE_ROOT;
    if (ORIGINAL_WORKSPACES === undefined) delete process.env.AGENT_WORKSPACES;
    else process.env.AGENT_WORKSPACES = ORIGINAL_WORKSPACES;
  });

  it("returns items on success", async () => {
    vi.resetModules();
    fetchSkillsMock.mockResolvedValueOnce([
      { name: "alpha", description: "desc", argumentHint: "", source: "project" }
    ]);
    const { registerSystemRoutes } = await import("../../../src/server/routes/system.js");
    const wsRoot = process.cwd();
    process.env.AGENT_WORKSPACE_ROOT = wsRoot;
    process.env.AGENT_WORKSPACES = "";
    const registry = new WorkspaceRegistry();
    const { app, gets } = makeApp();
    registerSystemRoutes({ app: app as never, workspaceRegistry: registry, defaultSettings: defaults, activeQueries: new Map() });

    const res = makeMockRes();
    await gets.get("/api/skills")!({ body: {}, query: {} } as Request, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      count: 1
    });
  });

  it("returns 500 when fetchSkills throws", async () => {
    vi.resetModules();
    fetchSkillsMock.mockRejectedValueOnce(new Error("boom"));
    const { registerSystemRoutes } = await import("../../../src/server/routes/system.js");
    const wsRoot = process.cwd();
    process.env.AGENT_WORKSPACE_ROOT = wsRoot;
    process.env.AGENT_WORKSPACES = "";
    const registry = new WorkspaceRegistry();
    const { app, gets } = makeApp();
    registerSystemRoutes({ app: app as never, workspaceRegistry: registry, defaultSettings: defaults, activeQueries: new Map() });

    const res = makeMockRes();
    await gets.get("/api/skills")!({ body: {}, query: {} } as Request, res);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ ok: false, error: "boom", items: [] });
  });
});
