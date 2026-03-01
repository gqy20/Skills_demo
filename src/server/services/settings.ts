import path from "node:path";
import { promises as fs } from "node:fs";
import type { RuntimeSettings } from "../types.js";

export function settingsFileFor(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".info", "agent-web-settings.json");
}

function normalizeRuntimeEnv(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const name = String(key || "").trim();
    if (!name) continue;
    if (typeof value !== "string") continue;
    const val = value.trim();
    if (!val) continue;
    out[name] = val;
  }
  return out;
}

export async function readSettings(workspaceRoot: string, defaults: RuntimeSettings): Promise<RuntimeSettings> {
  const settingsFile = settingsFileFor(workspaceRoot);
  try {
    const raw = await fs.readFile(settingsFile, "utf-8");
    const parsed = JSON.parse(raw) as Partial<RuntimeSettings>;
    const permissionProfile =
      parsed.permissionProfile === "standard" ||
      parsed.permissionProfile === "accept_edits" ||
      parsed.permissionProfile === "full_auto"
        ? parsed.permissionProfile
        : defaults.permissionProfile;
    return {
      model: parsed.model || defaults.model,
      baseUrl: parsed.baseUrl || defaults.baseUrl,
      authToken: parsed.authToken || defaults.authToken,
      runtimeEnv: { ...defaults.runtimeEnv, ...normalizeRuntimeEnv((parsed as { runtimeEnv?: unknown }).runtimeEnv) },
      permissionProfile,
      mcpEnabled: typeof parsed.mcpEnabled === "boolean" ? parsed.mcpEnabled : defaults.mcpEnabled,
      speedModeEnabled:
        typeof parsed.speedModeEnabled === "boolean" ? parsed.speedModeEnabled : defaults.speedModeEnabled,
      toolGateEnabled:
        permissionProfile === "standard"
          ? typeof parsed.toolGateEnabled === "boolean"
            ? parsed.toolGateEnabled
            : defaults.toolGateEnabled
          : false,
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
