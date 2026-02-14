import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import type { Request, Response } from "express";
import { afterEach, describe, expect, it } from "vitest";
import { registerSystemRoutes } from "../../../src/server/routes/system.js";
import { writeSettings } from "../../../src/server/services/settings.js";
import { WorkspaceRegistry } from "../../../src/server/services/workspaces.js";
import type { RuntimeSettings } from "../../../src/server/types.js";

type Handler = (req: Request, res: Response) => void | Promise<void>;

type MockRes = Response & {
  statusCode: number;
  body: unknown;
};

const ORIGINAL_WORKSPACE_ROOT = process.env.AGENT_WORKSPACE_ROOT;
const ORIGINAL_WORKSPACES = process.env.AGENT_WORKSPACES;
const tempRoots: string[] = [];

const defaults: RuntimeSettings = {
  model: "m1",
  baseUrl: "https://example.com",
  authToken: "",
  mineruApiKey: "",
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
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body;
    }
  };
  return res as unknown as MockRes;
}

function restoreEnv(): void {
  if (ORIGINAL_WORKSPACE_ROOT === undefined) delete process.env.AGENT_WORKSPACE_ROOT;
  else process.env.AGENT_WORKSPACE_ROOT = ORIGINAL_WORKSPACE_ROOT;
  if (ORIGINAL_WORKSPACES === undefined) delete process.env.AGENT_WORKSPACES;
  else process.env.AGENT_WORKSPACES = ORIGINAL_WORKSPACES;
}

async function makeWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "skills-demo-system-route-"));
  tempRoots.push(root);
  return root;
}

function makeApp() {
  const gets = new Map<string, Handler>();
  const posts = new Map<string, Handler>();
  return {
    app: {
      get(route: string, handler: Handler) {
        gets.set(route, handler);
      },
      post(route: string, handler: Handler) {
        posts.set(route, handler);
      }
    },
    gets,
    posts
  };
}

describe("registerSystemRoutes", () => {
  afterEach(async () => {
    restoreEnv();
    await Promise.all(tempRoots.splice(0, tempRoots.length).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("serves /api/workspaces and /api/health", async () => {
    const ws = await makeWorkspace();
    process.env.AGENT_WORKSPACE_ROOT = ws;
    process.env.AGENT_WORKSPACES = "";
    const registry = new WorkspaceRegistry();
    const { app, gets } = makeApp();
    registerSystemRoutes({ app: app as never, workspaceRegistry: registry, defaultSettings: defaults });

    const workspacesRes = makeMockRes();
    await gets.get("/api/workspaces")!({} as Request, workspacesRes);
    expect(workspacesRes.statusCode).toBe(200);
    expect((workspacesRes.body as { ok: boolean }).ok).toBe(true);

    const healthRes = makeMockRes();
    await gets.get("/api/health")!({ body: {}, query: {} } as Request, healthRes);
    expect(healthRes.statusCode).toBe(200);
    expect(healthRes.body).toMatchObject({
      ok: true,
      transport: "ui-message-stream",
      hooksMode: "project-hooks-enabled"
    });
  });

  it("reads saved settings for /api/settings and health hook mode", async () => {
    const ws = await makeWorkspace();
    process.env.AGENT_WORKSPACE_ROOT = ws;
    process.env.AGENT_WORKSPACES = "";
    await writeSettings(ws, { ...defaults, speedModeEnabled: true, authToken: "abcd1234" });
    const registry = new WorkspaceRegistry();
    const { app, gets } = makeApp();
    registerSystemRoutes({ app: app as never, workspaceRegistry: registry, defaultSettings: defaults });

    const settingsRes = makeMockRes();
    await gets.get("/api/settings")!({ body: {}, query: {} } as Request, settingsRes);
    expect(settingsRes.statusCode).toBe(200);
    expect(settingsRes.body).toMatchObject({
      speedModeEnabled: true,
      hasToken: true,
      tokenPreview: "********"
    });

    const healthRes = makeMockRes();
    await gets.get("/api/health")!({ body: {}, query: {} } as Request, healthRes);
    expect((healthRes.body as { hooksMode: string }).hooksMode).toBe("disabled-by-speed-mode");
  });

  it("validates /api/files path and clamps depth", async () => {
    const ws = await makeWorkspace();
    await mkdir(path.join(ws, "src"), { recursive: true });
    await writeFile(path.join(ws, "src", "main.ts"), "export {};\n");
    process.env.AGENT_WORKSPACE_ROOT = ws;
    process.env.AGENT_WORKSPACES = "";
    const registry = new WorkspaceRegistry();
    const { app, gets } = makeApp();
    registerSystemRoutes({ app: app as never, workspaceRegistry: registry, defaultSettings: defaults });

    const badRes = makeMockRes();
    await gets.get("/api/files")!({ body: {}, query: { path: "../etc", depth: "1" } } as Request, badRes);
    expect(badRes.statusCode).toBe(400);
    expect(badRes.body).toEqual({ ok: false, error: "invalid path" });

    const okRes = makeMockRes();
    await gets.get("/api/files")!({ body: {}, query: { path: "", depth: "99" } } as Request, okRes);
    expect(okRes.statusCode).toBe(200);
    expect(okRes.body).toMatchObject({
      ok: true,
      depth: 3
    });
  });
});
