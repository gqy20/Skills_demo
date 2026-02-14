import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { maskToken, readSettings, settingsFileFor, writeSettings } from "../../../src/server/services/settings.js";
import type { RuntimeSettings } from "../../../src/server/types.js";

const tempRoots: string[] = [];

const defaults: RuntimeSettings = {
  model: "default-model",
  baseUrl: "https://default",
  authToken: "",
  mineruApiKey: "",
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
    await Promise.all(tempRoots.splice(0, tempRoots.length).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("returns defaults when settings file is missing", async () => {
    const root = await makeWorkspace();
    await expect(readSettings(root, defaults)).resolves.toEqual(defaults);
  });

  it("writes and reads settings", async () => {
    const root = await makeWorkspace();
    const next: RuntimeSettings = { ...defaults, model: "m2", authToken: "abcd1234", speedModeEnabled: true };
    await writeSettings(root, next);
    await expect(readSettings(root, defaults)).resolves.toEqual(next);
    expect(settingsFileFor(root)).toBe(path.join(root, ".info", "agent-web-settings.json"));
  });

  it("masks token previews", () => {
    expect(maskToken("")).toBe("");
    expect(maskToken("short")).toBe("********");
    expect(maskToken("abcd1234efgh")).toBe("abcd...efgh");
  });
});
