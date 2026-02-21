import { describe, expect, it } from "vitest";
import {
  buildInitialSkillUsage,
  buildQueuedExecutionState,
  buildInitialTurnTrace,
  resetDiagnosticsForTurn
} from "../../../src/webapp/lib/turnState.js";

describe("turnState", () => {
  it("builds initial skill usage map from slash command", () => {
    const now = 1700000000000;
    const usage = buildInitialSkillUsage("/summarize  请分析", "summarize", now);
    expect(usage).toEqual({
      summarize: {
        count: 1,
        lastTs: now,
        details: { source: "prompt", text: "/summarize  请分析" }
      }
    });
  });

  it("returns empty skill usage when command is missing", () => {
    expect(buildInitialSkillUsage("hello", "", Date.now())).toEqual({});
  });

  it("builds queued execution state", () => {
    expect(buildQueuedExecutionState(100)).toEqual({
      phase: "queued",
      currentTool: "",
      toolElapsedSeconds: 0,
      lastDeltaAt: 100,
      actions: [],
      dismissNoDelta: false
    });
  });

  it("builds initial turn trace", () => {
    const now = 100;
    expect(buildInitialTurnTrace(now)).toEqual({
      startedAt: now,
      completedAt: 0,
      seenToolUseIds: {},
      responseStarted: false,
      lastToolLabel: "",
      skills: {},
      tools: {},
      phases: [{ phase: "queued", at: now }],
      actions: []
    });
  });

  it("resets diagnostics turn counters", () => {
    expect(resetDiagnosticsForTurn({ toolGateEnabled: false, gateHits: 9, askCreated: 2, askResolved: 2 })).toEqual({
      toolGateEnabled: false,
      gateHits: 0,
      askCreated: 0,
      askResolved: 0
    });
  });
});
