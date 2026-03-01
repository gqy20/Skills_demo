import { describe, expect, it } from "vitest";
import { buildQueryOptions, withTimeout } from "../../../src/server/services/query.js";
import type { RuntimeSettings } from "../../../src/server/types.js";

const baseSettings: RuntimeSettings = {
  model: "m1",
  baseUrl: "https://example.com",
  authToken: "token",
  runtimeEnv: { MINERU_API_KEY: "mineru" },
  permissionProfile: "standard",
  mcpEnabled: true,
  speedModeEnabled: false,
  toolGateEnabled: true,
  debugEnabled: false,
  debugSseEnabled: false
};

describe("query service", () => {
  const ORIG_MODEL = process.env.ANTHROPIC_MODEL;
  const ORIG_BASE = process.env.ANTHROPIC_BASE_URL;
  const ORIG_TOKEN = process.env.ANTHROPIC_AUTH_TOKEN;
  const ORIG_MINERU = process.env.MINERU_API_KEY;

  function resetCoreEnv(): void {
    if (ORIG_MODEL === undefined) delete process.env.ANTHROPIC_MODEL;
    else process.env.ANTHROPIC_MODEL = ORIG_MODEL;
    if (ORIG_BASE === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = ORIG_BASE;
    if (ORIG_TOKEN === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN;
    else process.env.ANTHROPIC_AUTH_TOKEN = ORIG_TOKEN;
    if (ORIG_MINERU === undefined) delete process.env.MINERU_API_KEY;
    else process.env.MINERU_API_KEY = ORIG_MINERU;
  }

  it("resolves withTimeout when promise resolves in time", async () => {
    resetCoreEnv();
    await expect(withTimeout(Promise.resolve("ok"), 100, "x")).resolves.toBe("ok");
  });

  it("rejects withTimeout when promise exceeds timeout", async () => {
    resetCoreEnv();
    const never = new Promise<string>(() => {});
    await expect(withTimeout(never, 10, "probe")).rejects.toThrow("probe timed out after 10ms");
  });

  it("builds query options with resume in normal mode", () => {
    delete process.env.ANTHROPIC_MODEL;
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.MINERU_API_KEY;
    const options = buildQueryOptions("/tmp/ws", baseSettings, "web-session", "sdk-session");
    expect(options.cwd).toBe("/tmp/ws");
    expect(options.resume).toBe("sdk-session");
    expect(options.settingSources).toEqual(["project"]);
    expect(options.thinking).toBeUndefined();
    expect(options.env?.ANTHROPIC_MODEL).toBe("m1");
    expect(options.env?.MINERU_API_KEY).toBe("mineru");
  });

  it("builds speed mode options with disabled thinking and sessionId", () => {
    resetCoreEnv();
    const settings: RuntimeSettings = { ...baseSettings, speedModeEnabled: true };
    const options = buildQueryOptions("/tmp/ws", settings, "web-session", undefined);
    expect(options.sessionId).toBe("web-session");
    expect(options.settingSources).toEqual([]);
    expect(options.thinking).toEqual({ type: "disabled" });
  });

  it("prefers process env over settings env for core model keys", () => {
    process.env.ANTHROPIC_MODEL = "from-env";
    process.env.ANTHROPIC_BASE_URL = "https://env.example";
    process.env.ANTHROPIC_AUTH_TOKEN = "env-token";
    process.env.MINERU_API_KEY = "env-mineru";
    const options = buildQueryOptions("/tmp/ws", baseSettings, "web-session", undefined);
    expect(options.env?.ANTHROPIC_MODEL).toBe("from-env");
    expect(options.env?.ANTHROPIC_BASE_URL).toBe("https://env.example");
    expect(options.env?.ANTHROPIC_AUTH_TOKEN).toBe("env-token");
    expect(options.env?.MINERU_API_KEY).toBe("env-mineru");
    resetCoreEnv();
  });
});
