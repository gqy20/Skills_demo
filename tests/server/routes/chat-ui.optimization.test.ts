import { afterEach, describe, expect, it } from "vitest";
import type { RuntimeSettings } from "../../../src/server/types.js";
import {
  shouldRunPerTurnMcpProbe,
  shouldRunPerTurnMcpToggle,
  shouldRunDebugProbesBlocking
} from "../../../src/server/routes/chat-ui-optimization.js";

const ORIGINAL_OPTIMIZE = process.env.AGENT_WEB_OPTIMIZE_CONTROLS;

const baseSettings: RuntimeSettings = {
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

describe("chat ui optimization flags", () => {
  afterEach(() => {
    if (ORIGINAL_OPTIMIZE === undefined) delete process.env.AGENT_WEB_OPTIMIZE_CONTROLS;
    else process.env.AGENT_WEB_OPTIMIZE_CONTROLS = ORIGINAL_OPTIMIZE;
  });

  it("enables optimization by default", () => {
    delete process.env.AGENT_WEB_OPTIMIZE_CONTROLS;
    expect(shouldRunPerTurnMcpProbe()).toBe(false);
    expect(shouldRunPerTurnMcpToggle(baseSettings)).toBe(false);
    expect(shouldRunDebugProbesBlocking()).toBe(false);
  });

  it("supports explicit opt-out for troubleshooting", () => {
    process.env.AGENT_WEB_OPTIMIZE_CONTROLS = "0";
    expect(shouldRunPerTurnMcpProbe()).toBe(true);
    expect(shouldRunPerTurnMcpToggle(baseSettings)).toBe(true);
    expect(shouldRunDebugProbesBlocking()).toBe(true);
  });

  it("never toggles mcp per turn in speed mode", () => {
    process.env.AGENT_WEB_OPTIMIZE_CONTROLS = "0";
    expect(shouldRunPerTurnMcpToggle({ ...baseSettings, speedModeEnabled: true })).toBe(false);
  });
});

