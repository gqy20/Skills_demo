import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { Request } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeSettings } from "../../../src/server/types.js";

const { invalidateSkillsCacheMock, fetchSkillsMock } = vi.hoisted(() => ({
  invalidateSkillsCacheMock: vi.fn(),
  fetchSkillsMock: vi.fn(async () => [])
}));

vi.mock("../../../src/server/services/skills.js", () => ({
  fetchSkills: fetchSkillsMock,
  invalidateSkillsCache: invalidateSkillsCacheMock
}));

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

function createRouteMaps() {
  const gets = new Map<string, (req: Request, res: MockRes) => unknown>();
  const posts = new Map<string, (req: Request, res: MockRes) => unknown>();
  const puts = new Map<string, (req: Request, res: MockRes) => unknown>();
  const deletes = new Map<string, (req: Request, res: MockRes) => unknown>();
  const app = {
    get: vi.fn((route: string, handler: (req: Request, res: MockRes) => unknown) => gets.set(route, handler)),
    post: vi.fn((route: string, handler: (req: Request, res: MockRes) => unknown) => posts.set(route, handler)),
    put: vi.fn((route: string, handler: (req: Request, res: MockRes) => unknown) => puts.set(route, handler)),
    delete: vi.fn((route: string, handler: (req: Request, res: MockRes) => unknown) => deletes.set(route, handler))
  };
  return { app, gets, posts, puts, deletes };
}

const defaults: RuntimeSettings = {
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

describe("system settings optimization", () => {
  const roots: string[] = [];
  const ORIGINAL_AGENT_WORKSPACE_ROOT = process.env.AGENT_WORKSPACE_ROOT;
  const ORIGINAL_AGENT_WORKSPACES = process.env.AGENT_WORKSPACES;
  const ORIGINAL_AGENT_WEB_MCP_AUTO_REFRESH = process.env.AGENT_WEB_MCP_AUTO_REFRESH;

  afterEach(async () => {
    invalidateSkillsCacheMock.mockReset();
    fetchSkillsMock.mockReset();
    if (ORIGINAL_AGENT_WORKSPACE_ROOT === undefined) delete process.env.AGENT_WORKSPACE_ROOT;
    else process.env.AGENT_WORKSPACE_ROOT = ORIGINAL_AGENT_WORKSPACE_ROOT;
    if (ORIGINAL_AGENT_WORKSPACES === undefined) delete process.env.AGENT_WORKSPACES;
    else process.env.AGENT_WORKSPACES = ORIGINAL_AGENT_WORKSPACES;
    if (ORIGINAL_AGENT_WEB_MCP_AUTO_REFRESH === undefined) delete process.env.AGENT_WEB_MCP_AUTO_REFRESH;
    else process.env.AGENT_WEB_MCP_AUTO_REFRESH = ORIGINAL_AGENT_WEB_MCP_AUTO_REFRESH;
    await Promise.all(roots.splice(0, roots.length).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("invalidates skills cache after POST /api/settings", async () => {
    const [{ registerSystemRoutes }, { WorkspaceRegistry }] = await Promise.all([
      import("../../../src/server/routes/system.js"),
      import("../../../src/server/services/workspaces.js")
    ]);

    const ws = await mkdtemp(path.join(os.tmpdir(), "skills-demo-system-opt-"));
    roots.push(ws);
    process.env.AGENT_WORKSPACE_ROOT = ws;
    delete process.env.AGENT_WORKSPACES;
    const registry = new WorkspaceRegistry();
    const { app, posts } = createRouteMaps();

    registerSystemRoutes({ app: app as never, workspaceRegistry: registry, defaultSettings: defaults, activeQueries: new Map() });
    const res = makeMockRes();
    await posts.get("/api/settings")!(
      {
        body: {
          model: "m2",
          baseUrl: "https://example2.com",
          authToken: "token2"
        },
        query: {}
      } as Request,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(invalidateSkillsCacheMock).toHaveBeenCalledOnce();
    expect(invalidateSkillsCacheMock).toHaveBeenCalledWith(ws);
  });

  it("triggers mcp probe after settings save when mcp is enabled and active query exists", async () => {
    const [{ registerSystemRoutes }, { WorkspaceRegistry }] = await Promise.all([
      import("../../../src/server/routes/system.js"),
      import("../../../src/server/services/workspaces.js")
    ]);

    const ws = await mkdtemp(path.join(os.tmpdir(), "skills-demo-system-opt-"));
    roots.push(ws);
    await writeFile(path.join(ws, ".mcp.json"), JSON.stringify({ mcpServers: { demo: { type: "stdio", command: "echo", args: ["ok"] } } }), "utf-8");
    process.env.AGENT_WORKSPACE_ROOT = ws;
    delete process.env.AGENT_WORKSPACES;
    const registry = new WorkspaceRegistry();
    const workspaceId = registry.defaultWorkspace?.id || "";
    const mcpServerStatus = vi.fn(async () => []);
    const activeQueries = new Map<string, unknown>([[`${workspaceId}:session-1`, { mcpServerStatus }]]);
    const { app, posts } = createRouteMaps();

    registerSystemRoutes({ app: app as never, workspaceRegistry: registry, defaultSettings: defaults, activeQueries: activeQueries as never });
    const res = makeMockRes();
    await posts.get("/api/settings")!(
      {
        body: {
          model: "m2",
          baseUrl: "https://example2.com",
          authToken: "token2",
          mcpEnabled: true
        },
        query: {}
      } as Request,
      res
    );

    expect(res.statusCode).toBe(200);
    expect((res.body as Record<string, unknown>)?.mcpRefresh).toMatchObject({ started: true, reason: "started" });
    expect(mcpServerStatus).toHaveBeenCalledOnce();
  });

  it("forces mcp probe on GET /api/mcps?refresh=1", async () => {
    const [{ registerSystemRoutes }, { WorkspaceRegistry }] = await Promise.all([
      import("../../../src/server/routes/system.js"),
      import("../../../src/server/services/workspaces.js")
    ]);

    const ws = await mkdtemp(path.join(os.tmpdir(), "skills-demo-system-opt-"));
    roots.push(ws);
    await writeFile(path.join(ws, ".mcp.json"), JSON.stringify({ mcpServers: { demo: { type: "stdio", command: "echo", args: ["ok"] } } }), "utf-8");
    process.env.AGENT_WORKSPACE_ROOT = ws;
    delete process.env.AGENT_WORKSPACES;
    const registry = new WorkspaceRegistry();
    const workspaceId = registry.defaultWorkspace?.id || "";
    const mcpServerStatus = vi.fn(async () => []);
    const activeQueries = new Map<string, unknown>([[`${workspaceId}:session-1`, { mcpServerStatus }]]);
    const { app, gets } = createRouteMaps();

    registerSystemRoutes({ app: app as never, workspaceRegistry: registry, defaultSettings: defaults, activeQueries: activeQueries as never });
    const res = makeMockRes();
    await gets.get("/api/mcps")!(
      {
        body: {},
        query: { refresh: "1" }
      } as Request,
      res
    );

    expect(res.statusCode).toBe(200);
    expect((res.body as Record<string, unknown>)?.refresh).toMatchObject({ started: true, reason: "started" });
    expect(mcpServerStatus).toHaveBeenCalledOnce();
  });

  it("auto refreshes stale mcp snapshot on GET /api/mcps", async () => {
    const [{ registerSystemRoutes }, { WorkspaceRegistry }] = await Promise.all([
      import("../../../src/server/routes/system.js"),
      import("../../../src/server/services/workspaces.js")
    ]);

    const ws = await mkdtemp(path.join(os.tmpdir(), "skills-demo-system-opt-"));
    roots.push(ws);
    await writeFile(path.join(ws, ".mcp.json"), JSON.stringify({ mcpServers: { demo: { type: "stdio", command: "echo", args: ["ok"] } } }), "utf-8");
    process.env.AGENT_WORKSPACE_ROOT = ws;
    delete process.env.AGENT_WORKSPACES;
    delete process.env.AGENT_WEB_MCP_AUTO_REFRESH;
    const registry = new WorkspaceRegistry();
    const workspaceId = registry.defaultWorkspace?.id || "";
    const mcpServerStatus = vi.fn(async () => []);
    const activeQueries = new Map<string, unknown>([[`${workspaceId}:session-1`, { mcpServerStatus }]]);
    const { app, gets } = createRouteMaps();

    registerSystemRoutes({ app: app as never, workspaceRegistry: registry, defaultSettings: defaults, activeQueries: activeQueries as never });
    const res = makeMockRes();
    await gets.get("/api/mcps")!(
      {
        body: {},
        query: {}
      } as Request,
      res
    );

    expect(res.statusCode).toBe(200);
    expect((res.body as Record<string, unknown>)?.refresh).toMatchObject({ started: true, reason: "started" });
    expect(mcpServerStatus).toHaveBeenCalledOnce();
  });

  it("can disable stale auto refresh via env", async () => {
    const [{ registerSystemRoutes }, { WorkspaceRegistry }] = await Promise.all([
      import("../../../src/server/routes/system.js"),
      import("../../../src/server/services/workspaces.js")
    ]);

    const ws = await mkdtemp(path.join(os.tmpdir(), "skills-demo-system-opt-"));
    roots.push(ws);
    await writeFile(path.join(ws, ".mcp.json"), JSON.stringify({ mcpServers: { demo: { type: "stdio", command: "echo", args: ["ok"] } } }), "utf-8");
    process.env.AGENT_WORKSPACE_ROOT = ws;
    delete process.env.AGENT_WORKSPACES;
    process.env.AGENT_WEB_MCP_AUTO_REFRESH = "0";
    const registry = new WorkspaceRegistry();
    const workspaceId = registry.defaultWorkspace?.id || "";
    const mcpServerStatus = vi.fn(async () => []);
    const activeQueries = new Map<string, unknown>([[`${workspaceId}:session-1`, { mcpServerStatus }]]);
    const { app, gets } = createRouteMaps();

    registerSystemRoutes({ app: app as never, workspaceRegistry: registry, defaultSettings: defaults, activeQueries: activeQueries as never });
    const res = makeMockRes();
    await gets.get("/api/mcps")!(
      {
        body: {},
        query: {}
      } as Request,
      res
    );

    expect(res.statusCode).toBe(200);
    expect((res.body as Record<string, unknown>)?.refresh).toBeNull();
    expect(mcpServerStatus).not.toHaveBeenCalled();
  });
});
