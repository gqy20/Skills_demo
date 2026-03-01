import { describe, expect, it } from "vitest";
import { buildQueryOptions, withTimeout } from "../../../src/server/services/query.js";
import type { RuntimeSettings } from "../../../src/server/types.js";

const baseSettings: RuntimeSettings = {
  model: "m1",
  baseUrl: "https://example.com",
  authToken: "token",
  mineruApiKey: "mineru",
  mcpEnv: {},
  permissionProfile: "standard",
  mcpEnabled: true,
  speedModeEnabled: false,
  toolGateEnabled: true,
  debugEnabled: false,
  debugSseEnabled: false
};

describe("query service", () => {
  it("resolves withTimeout when promise resolves in time", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 100, "x")).resolves.toBe("ok");
  });

  it("rejects withTimeout when promise exceeds timeout", async () => {
    const never = new Promise<string>(() => {});
    await expect(withTimeout(never, 10, "probe")).rejects.toThrow("probe timed out after 10ms");
  });

  it("builds query options with resume in normal mode", () => {
    const options = buildQueryOptions("/tmp/ws", baseSettings, "web-session", "sdk-session");
    expect(options.cwd).toBe("/tmp/ws");
    expect(options.resume).toBe("sdk-session");
    expect(options.settingSources).toEqual(["project"]);
    expect(options.thinking).toBeUndefined();
    expect(options.env?.ANTHROPIC_MODEL).toBe("m1");
  });

  it("builds speed mode options with disabled thinking and sessionId", () => {
    const settings: RuntimeSettings = { ...baseSettings, speedModeEnabled: true };
    const options = buildQueryOptions("/tmp/ws", settings, "web-session", undefined);
    expect(options.sessionId).toBe("web-session");
    expect(options.settingSources).toEqual([]);
    expect(options.thinking).toEqual({ type: "disabled" });
  });
});
