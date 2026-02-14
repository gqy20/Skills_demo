import type { Request, Response } from "express";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceRegistry } from "../../../src/server/services/workspaces.js";

const ORIGINAL_WORKSPACE_ROOT = process.env.AGENT_WORKSPACE_ROOT;
const ORIGINAL_WORKSPACES = process.env.AGENT_WORKSPACES;

function setWorkspaceEnv(root: string, others = ""): void {
  process.env.AGENT_WORKSPACE_ROOT = root;
  process.env.AGENT_WORKSPACES = others;
}

function restoreEnv(): void {
  if (ORIGINAL_WORKSPACE_ROOT === undefined) delete process.env.AGENT_WORKSPACE_ROOT;
  else process.env.AGENT_WORKSPACE_ROOT = ORIGINAL_WORKSPACE_ROOT;
  if (ORIGINAL_WORKSPACES === undefined) delete process.env.AGENT_WORKSPACES;
  else process.env.AGENT_WORKSPACES = ORIGINAL_WORKSPACES;
}

describe("WorkspaceRegistry", () => {
  afterEach(() => restoreEnv());

  it("builds workspace map and default workspace from env", () => {
    setWorkspaceEnv("/tmp/Project Alpha", "/tmp/Project Alpha\n/tmp/project-beta");
    const registry = new WorkspaceRegistry();
    expect(Array.from(registry.map.keys())).toEqual(["project-alpha", "project-beta"]);
    expect(registry.defaultWorkspace?.id).toBe("project-alpha");
  });

  it("adds numeric suffix for duplicate sanitized ids", () => {
    setWorkspaceEnv("/tmp/A B", "/tmp/A-B");
    const registry = new WorkspaceRegistry();
    expect(Array.from(registry.map.keys())).toEqual(["a-b", "a-b-2"]);
  });

  it("resolves workspace id from request body first, then query", () => {
    setWorkspaceEnv("/tmp/root-one", "/tmp/root-two");
    const registry = new WorkspaceRegistry();
    const reqBody = { body: { workspaceId: "root-two" }, query: { workspaceId: "root-one" } } as Request;
    expect(registry.resolveWorkspaceFromRequest(reqBody)?.id).toBe("root-two");
    const reqQuery = { body: {}, query: { workspaceId: "root-one" } } as Request;
    expect(registry.resolveWorkspaceFromRequest(reqQuery)?.id).toBe("root-one");
  });

  it("returns 400 in requireWorkspace when id is invalid", () => {
    setWorkspaceEnv("/tmp/root-one");
    const registry = new WorkspaceRegistry();
    const req = { body: { workspaceId: "missing" }, query: {} } as Request;
    let statusCode = 0;
    let payload: unknown = null;
    const res = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(data: unknown) {
        payload = data;
        return this;
      }
    } as unknown as Response;

    expect(registry.requireWorkspace(req, res)).toBeNull();
    expect(statusCode).toBe(400);
    expect(payload).toEqual({ ok: false, error: "workspace not found" });
  });
});
