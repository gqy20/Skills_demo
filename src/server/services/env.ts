import path from "node:path";
import { promises as fs } from "node:fs";

function normalizeEnvValue(raw: string): string {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "";
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

export function hasEffectiveEnvValue(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return normalizeEnvValue(value).length > 0;
}

export function parseEnvText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = String(text || "").split(/\r?\n/);
  for (const line of lines) {
    const raw = line.trim();
    if (!raw || raw.startsWith("#")) continue;
    const idx = raw.indexOf("=");
    if (idx <= 0) continue;
    const key = raw.slice(0, idx).trim();
    if (!key) continue;
    const value = normalizeEnvValue(raw.slice(idx + 1));
    out[key] = value;
  }
  return out;
}

export async function readWorkspaceDotenv(workspaceRoot: string): Promise<Record<string, string>> {
  try {
    const envPath = path.join(workspaceRoot, ".env");
    const raw = await fs.readFile(envPath, "utf-8");
    return parseEnvText(raw);
  } catch {
    return {};
  }
}
