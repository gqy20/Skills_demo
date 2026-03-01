import path from "node:path";
import { promises as fs } from "node:fs";
import type { RuntimeSettings } from "../types.js";

type ParsedEnvLine =
  | { type: "pair"; key: string; value: string }
  | { type: "raw"; text: string };

function parseEnvLine(line: string): ParsedEnvLine {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
  if (!m) return { type: "raw", text: line };
  return { type: "pair", key: m[1], value: m[2] };
}

function normalizeEnvValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function buildManagedEnv(settings: RuntimeSettings): Record<string, string> {
  const out: Record<string, string> = {
    ANTHROPIC_MODEL: normalizeEnvValue(settings.model),
    ANTHROPIC_BASE_URL: normalizeEnvValue(settings.baseUrl),
    ANTHROPIC_AUTH_TOKEN: normalizeEnvValue(settings.authToken)
  };
  for (const [rawKey, rawValue] of Object.entries(settings.runtimeEnv || {})) {
    const key = String(rawKey || "").trim();
    const value = normalizeEnvValue(rawValue);
    if (!key || !value) continue;
    out[key] = value;
  }
  return out;
}

async function readEnvLines(envPath: string): Promise<string[]> {
  try {
    const raw = await fs.readFile(envPath, "utf-8");
    return raw.split(/\r?\n/);
  } catch {
    return [];
  }
}

async function writeEnvLines(envPath: string, lines: string[]): Promise<void> {
  const content = `${lines.join("\n").replace(/\n+$/g, "")}\n`;
  await fs.writeFile(envPath, content, "utf-8");
}

export async function syncSettingsToDotenv(
  workspaceRoot: string,
  settings: RuntimeSettings
): Promise<{ envFile: string; keys: string[] }> {
  const envPath = path.join(workspaceRoot, ".env");
  const updates = buildManagedEnv(settings);
  const keys = Object.keys(updates).sort();

  const existingLines = await readEnvLines(envPath);
  const pending = new Set(keys);
  const nextLines = existingLines.map((line) => {
    const parsed = parseEnvLine(line);
    if (parsed.type !== "pair") return line;
    if (!Object.prototype.hasOwnProperty.call(updates, parsed.key)) return line;
    pending.delete(parsed.key);
    return `${parsed.key}=${updates[parsed.key]}`;
  });

  for (const key of keys) {
    if (!pending.has(key)) continue;
    nextLines.push(`${key}=${updates[key]}`);
  }

  await writeEnvLines(envPath, nextLines);

  for (const [key, value] of Object.entries(updates)) {
    process.env[key] = value;
  }

  return { envFile: envPath, keys };
}
