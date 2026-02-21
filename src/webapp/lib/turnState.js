import { shortText } from "./chatUtils.js";

export function buildInitialSkillUsage(text, skillName, now) {
  if (!skillName) return {};
  return {
    [skillName]: {
      count: 1,
      lastTs: now,
      details: { source: "prompt", text: shortText(text, 220) }
    }
  };
}

export function resetDiagnosticsForTurn(prev) {
  return {
    ...prev,
    gateHits: 0,
    askCreated: 0,
    askResolved: 0
  };
}

export function buildQueuedExecutionState(now) {
  return {
    phase: "queued",
    currentTool: "",
    toolElapsedSeconds: 0,
    lastDeltaAt: now,
    actions: [],
    dismissNoDelta: false
  };
}

export function buildInitialTurnTrace(now) {
  return {
    startedAt: now,
    completedAt: 0,
    seenToolUseIds: {},
    responseStarted: false,
    lastToolLabel: "",
    skills: {},
    tools: {},
    phases: [{ phase: "queued", at: now }],
    actions: []
  };
}
