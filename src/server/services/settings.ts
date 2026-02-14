import path from "node:path";
import { promises as fs } from "node:fs";
import type { RuntimeSettings } from "../types.js";

export function settingsFileFor(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".info", "agent-web-settings.json");
}

export async function readSettings(workspaceRoot: string, defaults: RuntimeSettings): Promise<RuntimeSettings> {
  const settingsFile = settingsFileFor(workspaceRoot);
  try {
    const raw = await fs.readFile(settingsFile, "utf-8");
    const parsed = JSON.parse(raw) as Partial<RuntimeSettings>;
    return {
      model: parsed.model || defaults.model,
      baseUrl: parsed.baseUrl || defaults.baseUrl,
      authToken: parsed.authToken || defaults.authToken,
      mineruApiKey: parsed.mineruApiKey || defaults.mineruApiKey,
      mcpEnabled: typeof parsed.mcpEnabled === "boolean" ? parsed.mcpEnabled : defaults.mcpEnabled,
      speedModeEnabled:
        typeof parsed.speedModeEnabled === "boolean" ? parsed.speedModeEnabled : defaults.speedModeEnabled,
      toolGateEnabled:
        typeof parsed.toolGateEnabled === "boolean" ? parsed.toolGateEnabled : defaults.toolGateEnabled,
      debugEnabled: typeof parsed.debugEnabled === "boolean" ? parsed.debugEnabled : defaults.debugEnabled,
      debugSseEnabled: typeof parsed.debugSseEnabled === "boolean" ? parsed.debugSseEnabled : defaults.debugSseEnabled
    };
  } catch {
    return { ...defaults };
  }
}

export async function writeSettings(workspaceRoot: string, settings: RuntimeSettings): Promise<void> {
  const settingsFile = settingsFileFor(workspaceRoot);
  await fs.mkdir(path.dirname(settingsFile), { recursive: true });
  await fs.writeFile(settingsFile, JSON.stringify(settings, null, 2), "utf-8");
}

export function maskToken(token: string): string {
  if (!token) return "";
  if (token.length <= 8) return "********";
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}
