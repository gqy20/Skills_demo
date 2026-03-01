import path from "node:path";
import type { RuntimeSettings } from "../types.js";
import { hasEffectiveEnvValue, readWorkspaceDotenv } from "./env.js";
import { syncSettingsToDotenv } from "./dotenv-sync.js";

export function settingsFileFor(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".env");
}

const RESERVED_DOTENV_KEYS = new Set([
  "ANTHROPIC_MODEL",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "AGENT_WEB_PERMISSION_PROFILE",
  "AGENT_WEB_MCP_ENABLED",
  "AGENT_WEB_SPEED_MODE_ENABLED",
  "AGENT_WEB_TOOL_GATE_ENABLED",
  "AGENT_WEB_DEBUG_ENABLED",
  "AGENT_WEB_DEBUG_SSE_ENABLED"
]);

function parseBool(raw: unknown): boolean | null {
  if (typeof raw !== "string") return null;
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") return true;
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") return false;
  return null;
}

function readCoreValue(dotenv: Record<string, string>, key: string, fallback: string): string {
  if (Object.prototype.hasOwnProperty.call(dotenv, key)) {
    const value = String(dotenv[key] || "").trim();
    return hasEffectiveEnvValue(value) ? value : "";
  }
  const fromProcess = String(process.env[key] || "").trim();
  if (hasEffectiveEnvValue(fromProcess)) return fromProcess;
  return String(fallback || "").trim();
}

function readSwitch(dotenv: Record<string, string>, key: string, fallback: boolean): boolean {
  if (Object.prototype.hasOwnProperty.call(dotenv, key)) {
    const parsed = parseBool(dotenv[key]);
    if (parsed !== null) return parsed;
    return fallback;
  }
  const parsedFromProcess = parseBool(process.env[key]);
  if (parsedFromProcess !== null) return parsedFromProcess;
  return fallback;
}

export async function readSettings(workspaceRoot: string, defaults: RuntimeSettings): Promise<RuntimeSettings> {
  const dotenv = await readWorkspaceDotenv(workspaceRoot);

  const rawPermission = Object.prototype.hasOwnProperty.call(dotenv, "AGENT_WEB_PERMISSION_PROFILE")
    ? String(dotenv.AGENT_WEB_PERMISSION_PROFILE || "").trim()
    : String(process.env.AGENT_WEB_PERMISSION_PROFILE || "").trim();
  const permissionProfile =
    rawPermission === "standard" || rawPermission === "accept_edits" || rawPermission === "full_auto"
      ? rawPermission
      : defaults.permissionProfile;

  const runtimeEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(dotenv)) {
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey || RESERVED_DOTENV_KEYS.has(normalizedKey)) continue;
    if (!hasEffectiveEnvValue(value)) continue;
    runtimeEnv[normalizedKey] = String(value || "").trim();
  }

  const mcpEnabled = readSwitch(dotenv, "AGENT_WEB_MCP_ENABLED", defaults.mcpEnabled);
  const speedModeEnabled = readSwitch(dotenv, "AGENT_WEB_SPEED_MODE_ENABLED", defaults.speedModeEnabled);
  const requestedToolGateEnabled = readSwitch(dotenv, "AGENT_WEB_TOOL_GATE_ENABLED", defaults.toolGateEnabled);
  const debugEnabled = readSwitch(dotenv, "AGENT_WEB_DEBUG_ENABLED", defaults.debugEnabled);
  const debugSseEnabled = readSwitch(dotenv, "AGENT_WEB_DEBUG_SSE_ENABLED", defaults.debugSseEnabled);

  return {
    model: readCoreValue(dotenv, "ANTHROPIC_MODEL", defaults.model),
    baseUrl: readCoreValue(dotenv, "ANTHROPIC_BASE_URL", defaults.baseUrl),
    authToken: readCoreValue(dotenv, "ANTHROPIC_AUTH_TOKEN", defaults.authToken),
    runtimeEnv,
    permissionProfile,
    mcpEnabled,
    speedModeEnabled,
    toolGateEnabled: permissionProfile === "standard" ? requestedToolGateEnabled : false,
    debugEnabled,
    debugSseEnabled
  };
}

export async function writeSettings(workspaceRoot: string, settings: RuntimeSettings): Promise<void> {
  await syncSettingsToDotenv(workspaceRoot, settings);
}

export function maskToken(token: string): string {
  if (!token) return "";
  if (token.length <= 8) return "********";
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}
