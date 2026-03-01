import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { maskToken, readSettings, settingsFileFor, writeSettings } from "../../../src/server/services/settings.js";
import type { RuntimeSettings } from "../../../src/server/types.js";

const tempRoots: string[] = [];
const ORIGINAL_ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL;
const ORIGINAL_ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL;
const ORIGINAL_ANTHROPIC_AUTH_TOKEN = process.env.ANTHROPIC_AUTH_TOKEN;
const ORIGINAL_AGENT_WEB_PERMISSION_PROFILE = process.env.AGENT_WEB_PERMISSION_PROFILE;
const ORIGINAL_AGENT_WEB_MCP_ENABLED = process.env.AGENT_WEB_MCP_ENABLED;
const ORIGINAL_AGENT_WEB_SPEED_MODE_ENABLED = process.env.AGENT_WEB_SPEED_MODE_ENABLED;
const ORIGINAL_AGENT_WEB_TOOL_GATE_ENABLED = process.env.AGENT_WEB_TOOL_GATE_ENABLED;
const ORIGINAL_AGENT_WEB_DEBUG_ENABLED = process.env.AGENT_WEB_DEBUG_ENABLED;
const ORIGINAL_AGENT_WEB_DEBUG_SSE_ENABLED = process.env.AGENT_WEB_DEBUG_SSE_ENABLED;

const defaults: RuntimeSettings = {
  model: "default-model",
  baseUrl: "https://default",
  authToken: "",
  runtimeEnv: {},
  permissionProfile: "standard",
  mcpEnabled: true,
  speedModeEnabled: false,
  toolGateEnabled: true,
  debugEnabled: false,
  debugSseEnabled: false
};

async function makeWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "skills-demo-settings-"));
  tempRoots.push(root);
  return root;
}

describe("settings service", () => {
  afterEach(async () => {
    if (ORIGINAL_ANTHROPIC_MODEL === undefined) delete process.env.ANTHROPIC_MODEL;
    else process.env.ANTHROPIC_MODEL = ORIGINAL_ANTHROPIC_MODEL;
    if (ORIGINAL_ANTHROPIC_BASE_URL === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = ORIGINAL_ANTHROPIC_BASE_URL;
    if (ORIGINAL_ANTHROPIC_AUTH_TOKEN === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN;
    else process.env.ANTHROPIC_AUTH_TOKEN = ORIGINAL_ANTHROPIC_AUTH_TOKEN;
    if (ORIGINAL_AGENT_WEB_PERMISSION_PROFILE === undefined) delete process.env.AGENT_WEB_PERMISSION_PROFILE;
    else process.env.AGENT_WEB_PERMISSION_PROFILE = ORIGINAL_AGENT_WEB_PERMISSION_PROFILE;
    if (ORIGINAL_AGENT_WEB_MCP_ENABLED === undefined) delete process.env.AGENT_WEB_MCP_ENABLED;
    else process.env.AGENT_WEB_MCP_ENABLED = ORIGINAL_AGENT_WEB_MCP_ENABLED;
    if (ORIGINAL_AGENT_WEB_SPEED_MODE_ENABLED === undefined) delete process.env.AGENT_WEB_SPEED_MODE_ENABLED;
    else process.env.AGENT_WEB_SPEED_MODE_ENABLED = ORIGINAL_AGENT_WEB_SPEED_MODE_ENABLED;
    if (ORIGINAL_AGENT_WEB_TOOL_GATE_ENABLED === undefined) delete process.env.AGENT_WEB_TOOL_GATE_ENABLED;
    else process.env.AGENT_WEB_TOOL_GATE_ENABLED = ORIGINAL_AGENT_WEB_TOOL_GATE_ENABLED;
    if (ORIGINAL_AGENT_WEB_DEBUG_ENABLED === undefined) delete process.env.AGENT_WEB_DEBUG_ENABLED;
    else process.env.AGENT_WEB_DEBUG_ENABLED = ORIGINAL_AGENT_WEB_DEBUG_ENABLED;
    if (ORIGINAL_AGENT_WEB_DEBUG_SSE_ENABLED === undefined) delete process.env.AGENT_WEB_DEBUG_SSE_ENABLED;
    else process.env.AGENT_WEB_DEBUG_SSE_ENABLED = ORIGINAL_AGENT_WEB_DEBUG_SSE_ENABLED;
    await Promise.all(tempRoots.splice(0, tempRoots.length).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("returns defaults when .env is missing", async () => {
    const root = await makeWorkspace();
    delete process.env.ANTHROPIC_MODEL;
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.AGENT_WEB_PERMISSION_PROFILE;
    delete process.env.AGENT_WEB_MCP_ENABLED;
    delete process.env.AGENT_WEB_SPEED_MODE_ENABLED;
    delete process.env.AGENT_WEB_TOOL_GATE_ENABLED;
    delete process.env.AGENT_WEB_DEBUG_ENABLED;
    delete process.env.AGENT_WEB_DEBUG_SSE_ENABLED;
    await expect(readSettings(root, defaults)).resolves.toEqual(defaults);
  });

  it("writes and reads settings", async () => {
    const root = await makeWorkspace();
    const next: RuntimeSettings = { ...defaults, model: "m2", authToken: "abcd1234", speedModeEnabled: true };
    await writeSettings(root, next);
    await expect(readSettings(root, defaults)).resolves.toEqual(next);
    expect(settingsFileFor(root)).toBe(path.join(root, ".env"));
  });

  it("masks token previews", () => {
    expect(maskToken("")).toBe("");
    expect(maskToken("short")).toBe("********");
    expect(maskToken("abcd1234efgh")).toBe("abcd...efgh");
  });
});
