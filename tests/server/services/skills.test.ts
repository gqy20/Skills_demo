import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeSettings } from "../../../src/server/types.js";

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn()
}));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: queryMock
}));

const ORIGINAL_HOME = process.env.HOME;
const tempRoots: string[] = [];

const settings: RuntimeSettings = {
  model: "m1",
  baseUrl: "https://example.com",
  authToken: "token",
  mineruApiKey: "",
  permissionProfile: "standard",
  mcpEnabled: true,
  speedModeEnabled: false,
  toolGateEnabled: true,
  debugEnabled: false,
  debugSseEnabled: false
};

async function makeTemp(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

async function writeSkill(base: string, skillName: string, content: string): Promise<void> {
  const dir = path.join(base, ".claude", "skills", skillName);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "SKILL.md"), content, "utf-8");
}

describe("fetchSkills", () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  afterEach(async () => {
    if (ORIGINAL_HOME === undefined) delete process.env.HOME;
    else process.env.HOME = ORIGINAL_HOME;
    await Promise.all(tempRoots.splice(0, tempRoots.length).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("returns owned skills filtered by supported commands", async () => {
    const workspace = await makeTemp("skills-demo-skills-workspace-");
    const fakeHome = await makeTemp("skills-demo-skills-home-");
    process.env.HOME = fakeHome;
    await writeSkill(workspace, "alpha", "---\ndescription: Alpha from project\n---\n");

    const close = vi.fn();
    queryMock.mockReturnValue({
      supportedCommands: vi.fn(async () => [
        { name: "alpha", description: "---", argumentHint: "[topic]" },
        { name: "missing", description: "not-owned", argumentHint: "" }
      ]),
      close
    });

    const { fetchSkills } = await import("../../../src/server/services/skills.js");
    const items = await fetchSkills(workspace, settings, {
      buildQueryOptions: vi.fn(() => ({} as never)),
      withTimeout: async (p) => p
    });

    expect(items).toEqual([
      {
        name: "alpha",
        description: "Alpha from project",
        argumentHint: "[topic]",
        source: "project"
      }
    ]);
    expect(queryMock).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it("falls back to owned skills when supportedCommands fails", async () => {
    const workspace = await makeTemp("skills-demo-skills-workspace-");
    const fakeHome = await makeTemp("skills-demo-skills-home-");
    process.env.HOME = fakeHome;
    await writeSkill(workspace, "beta", "# Beta skill\nline one description");

    const close = vi.fn();
    queryMock.mockReturnValue({
      supportedCommands: vi.fn(async () => {
        throw new Error("sdk failed");
      }),
      close
    });

    const { fetchSkills } = await import("../../../src/server/services/skills.js");
    const items = await fetchSkills(workspace, settings, {
      buildQueryOptions: vi.fn(() => ({} as never)),
      withTimeout: async (p) => p
    });

    expect(items).toEqual([
      {
        name: "beta",
        description: "line one description",
        argumentHint: "",
        source: "project"
      }
    ]);
    expect(close).toHaveBeenCalledOnce();
  });

  it("uses cache for identical workspace+settings key", async () => {
    const workspace = await makeTemp("skills-demo-skills-workspace-");
    const fakeHome = await makeTemp("skills-demo-skills-home-");
    process.env.HOME = fakeHome;
    await writeSkill(workspace, "gamma", "# Gamma\ngamma desc");

    const close = vi.fn();
    queryMock.mockReturnValue({
      supportedCommands: vi.fn(async () => [{ name: "gamma", description: "from sdk", argumentHint: "" }]),
      close
    });

    const { fetchSkills } = await import("../../../src/server/services/skills.js");
    const deps = {
      buildQueryOptions: vi.fn(() => ({} as never)),
      withTimeout: async <T>(p: Promise<T>) => p
    };
    const first = await fetchSkills(workspace, settings, deps);
    const second = await fetchSkills(workspace, settings, deps);

    expect(first).toEqual(second);
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
