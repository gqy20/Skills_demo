import path from "node:path";
import type { Request, Response } from "express";
import type { WorkspaceInfo } from "../types.js";

function sanitizeWorkspaceId(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "workspace"
  );
}

function collectWorkspaceRoots(): string[] {
  const raw = String(process.env.AGENT_WORKSPACES || "").trim();
  const fromEnv = raw
    ? raw
        .split(/[,\n]/)
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
  const roots = [process.env.AGENT_WORKSPACE_ROOT || process.cwd(), ...fromEnv].map((item) => path.resolve(item));
  return Array.from(new Set(roots));
}

function buildWorkspaceMap(): Map<string, WorkspaceInfo> {
  const roots = collectWorkspaceRoots();
  const map = new Map<string, WorkspaceInfo>();
  const idCount = new Map<string, number>();
  for (const root of roots) {
    const base = sanitizeWorkspaceId(path.basename(root));
    const count = (idCount.get(base) || 0) + 1;
    idCount.set(base, count);
    const id = count === 1 ? base : `${base}-${count}`;
    map.set(id, { id, label: path.basename(root) || id, root });
  }
  return map;
}

function normalizeWorkspaceId(input: unknown): string {
  return typeof input === "string" ? input.trim() : "";
}

export class WorkspaceRegistry {
  readonly map: Map<string, WorkspaceInfo>;
  readonly defaultWorkspace: WorkspaceInfo | null;

  constructor() {
    this.map = buildWorkspaceMap();
    this.defaultWorkspace = (this.map.values().next().value || null) as WorkspaceInfo | null;
  }

  private getWorkspaceById(workspaceId: string): WorkspaceInfo | null {
    if (!workspaceId) return this.defaultWorkspace || null;
    return this.map.get(workspaceId) || null;
  }

  resolveWorkspaceFromRequest(req: Request): WorkspaceInfo | null {
    const fromBody = normalizeWorkspaceId(req.body?.workspaceId);
    const fromQuery = normalizeWorkspaceId(req.query?.workspaceId);
    return this.getWorkspaceById(fromBody || fromQuery || this.defaultWorkspace?.id || "");
  }

  requireWorkspace(req: Request, res: Response): WorkspaceInfo | null {
    const workspace = this.resolveWorkspaceFromRequest(req);
    if (!workspace) {
      res.status(400).json({ ok: false, error: "workspace not found" });
      return null;
    }
    return workspace;
  }
}
