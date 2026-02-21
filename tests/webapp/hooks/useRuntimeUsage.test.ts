import { describe, expect, it } from "vitest";
import { INITIAL_RUNTIME_USAGE, addMcpUsage, addSkillUsage } from "../../../src/webapp/hooks/useRuntimeUsage.js";

describe("useRuntimeUsage helpers", () => {
  it("adds skill usage", () => {
    const next = addSkillUsage(INITIAL_RUNTIME_USAGE, "commander", { source: "prompt" });
    expect(next.skills.commander.count).toBe(1);
    expect(next.skills.commander.details).toMatchObject({ source: "prompt" });
  });

  it("adds mcp usage from tool name", () => {
    const next = addMcpUsage(INITIAL_RUNTIME_USAGE, "mcp__paper__search", 3);
    expect(next.mcps["paper:search"].count).toBe(1);
    expect(next.mcps["paper:search"].details).toMatchObject({ server: "paper", tool: "search", elapsedSeconds: 3 });
  });

  it("ignores non-mcp tool names", () => {
    const next = addMcpUsage(INITIAL_RUNTIME_USAGE, "Read", 1);
    expect(next).toEqual(INITIAL_RUNTIME_USAGE);
  });
});
