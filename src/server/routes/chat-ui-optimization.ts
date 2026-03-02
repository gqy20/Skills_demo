import type { RuntimeSettings } from "../types.js";

function optimizeControlsEnabled(): boolean {
  return process.env.AGENT_WEB_OPTIMIZE_CONTROLS !== "0";
}

export function shouldRunPerTurnMcpProbe(): boolean {
  return !optimizeControlsEnabled();
}

export function shouldRunPerTurnMcpToggle(settings: RuntimeSettings): boolean {
  if (settings.speedModeEnabled) return false;
  return !optimizeControlsEnabled();
}

export function shouldRunDebugProbesBlocking(): boolean {
  return !optimizeControlsEnabled();
}

