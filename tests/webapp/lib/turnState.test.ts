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
      phaseDetail: "请求已提交，等待执行",
      phaseStartedAt: 100,
      phaseEtaSeconds: 3,
      lastActivityAt: 100,
      currentAgent: "",
      currentTool: "",
      toolElapsedSeconds: 0,
      lastDeltaAt: 100,
      taskRuntime: {
        tasks: {},
        running: 0,
        completed: 0,
        failed: 0,
        stopped: 0,
        parallelPeak: 0
      },
      actions: [],
      warnings: [],
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
