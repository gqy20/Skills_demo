import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeSettings } from "../../../src/server/types.js";
import { clearSlashNamesCache, resolveAvailableSlashNames } from "../../../src/server/routes/chat-ui-slash-cache.js";

const settings: RuntimeSettings = {
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

describe("chat ui slash cache", () => {
  afterEach(() => {
    clearSlashNamesCache();
  });

  it("uses fresh cache and avoids duplicate fetches", async () => {
    const fetchSkills = vi.fn(async () => [{ name: "alpha", description: "", argumentHint: "", source: "project" as const }]);
    const now = vi.fn(() => 1000);
    const first = await resolveAvailableSlashNames("/ws", settings, { fetchSkills, now });
    const second = await resolveAvailableSlashNames("/ws", settings, { fetchSkills, now });
    expect(first.source).toBe("fetched");
    expect(second.source).toBe("cache_fresh");
    expect(fetchSkills).toHaveBeenCalledTimes(1);
    expect(Array.from(second.names || [])).toEqual(["alpha"]);
  });

  it("falls back to stale cache on fetch error", async () => {
    const fetchOk = vi.fn(async () => [{ name: "beta", description: "", argumentHint: "", source: "project" as const }]);
    await resolveAvailableSlashNames("/ws", settings, { fetchSkills: fetchOk, now: () => 1000 });
    const fetchFail = vi.fn(async () => {
      throw new Error("boom");
    });
    const out = await resolveAvailableSlashNames("/ws", settings, { fetchSkills: fetchFail, now: () => 1000 + 61_000 });
    expect(out.source).toBe("cache_stale_on_error");
    expect(out.error).toContain("boom");
    expect(Array.from(out.names || [])).toEqual(["beta"]);
  });

  it("returns unavailable when no cache exists and fetch fails", async () => {
    const fetchFail = vi.fn(async () => {
      throw new Error("boom");
    });
    const out = await resolveAvailableSlashNames("/ws", settings, { fetchSkills: fetchFail, now: () => 1000 });
    expect(out.source).toBe("unavailable");
    expect(out.names).toBeNull();
    expect(out.error).toContain("boom");
  });
});

