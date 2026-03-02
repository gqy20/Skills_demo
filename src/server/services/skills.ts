import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { query, type SlashCommand } from "@anthropic-ai/claude-agent-sdk";
import type { RuntimeSettings, SkillItem } from "../types.js";

let skillsCache:
  | {
      key: string;
      workspaceRoot: string;
      expiresAt: number;
      items: SkillItem[];
    }
  | null = null;

const DEFAULT_SKILLS_CACHE_TTL_MS = 5 * 60_000;

function skillsCacheTtlMs(): number {
  const raw = Number(process.env.AGENT_WEB_SKILLS_CACHE_TTL_MS || "");
  if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  return DEFAULT_SKILLS_CACHE_TTL_MS;
}

export function invalidateSkillsCache(workspaceRoot?: string): void {
  if (!workspaceRoot) {
    skillsCache = null;
    return;
  }
  if (skillsCache?.workspaceRoot === workspaceRoot) {
    skillsCache = null;
  }
}

function skillsCacheKey(workspaceRoot: string, settings: RuntimeSettings): string {
  return JSON.stringify({
    workspaceRoot,
    speedModeEnabled: settings.speedModeEnabled,
    mcpEnabled: settings.mcpEnabled,
    toolGateEnabled: settings.toolGateEnabled
  });
}

function normalizeSkillName(name: string): string {
  return name.trim().toLowerCase();
}

function normalizeSkillDescription(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  return text || "无描述";
}

function isUsableSkillDescription(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (!text) return false;
  if (text === "---") return false;
  return true;
}

function parseFrontmatterDescription(raw: string): string {
  const lines = raw.split(/\r?\n/);
  if (lines.length < 3) return "";
  if (lines[0].trim() !== "---") return "";

  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === "---") {
      end = i;
      break;
    }
  }
  if (end <= 1) return "";

  for (let i = 1; i < end; i += 1) {
    const line = lines[i].trim();
    if (!line.toLowerCase().startsWith("description:")) continue;
    const value = line.slice("description:".length).trim();
    return normalizeSkillDescription(value.replace(/^['"]|['"]$/g, ""));
  }
  return "";
}

function summarizeSkillMarkdown(raw: string): string {
  const frontmatterDescription = parseFrontmatterDescription(raw);
  if (frontmatterDescription) return frontmatterDescription;

  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    if (line.startsWith("#")) continue;
    if (line.startsWith("```")) continue;
    if (line === "---") continue;
    return normalizeSkillDescription(line.replace(/^[-*]\s+/, "").slice(0, 220));
  }
  return "无描述";
}

async function collectLocalSkills(baseDir: string, source: SkillItem["source"]): Promise<SkillItem[]> {
  const items: SkillItem[] = [];
  try {
    const entries = await fs.readdir(baseDir, { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        if (!entry.isDirectory()) return;
        const skillFile = path.join(baseDir, entry.name, "SKILL.md");
        try {
          const raw = await fs.readFile(skillFile, "utf-8");
          items.push({
            name: normalizeSkillName(entry.name),
            description: summarizeSkillMarkdown(raw),
            argumentHint: "",
            source
          });
        } catch {
          // Ignore folders without SKILL.md
        }
      })
    );
  } catch {
    // Ignore missing or unreadable skill directory.
  }
  return items;
}

async function collectOwnedSkills(workspaceRoot: string): Promise<SkillItem[]> {
  const projectDir = path.join(workspaceRoot, ".claude", "skills");
  const userDir = path.join(os.homedir(), ".claude", "skills");
  const [projectItems, userItems] = await Promise.all([
    collectLocalSkills(projectDir, "project"),
    collectLocalSkills(userDir, "user")
  ]);
  const map = new Map<string, SkillItem>();
  for (const item of userItems) map.set(item.name, item);
  for (const item of projectItems) map.set(item.name, item);
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function normalizeSkills(commands: SlashCommand[], owned: SkillItem[]): SkillItem[] {
  const ownedMap = new Map<string, SkillItem>(owned.map((item) => [item.name, item]));
  return commands
    .map((c) => {
      const name = c.name || "";
      const normalized = normalizeSkillName(name);
      const ownedItem = ownedMap.get(normalized);
      if (!ownedItem) return null;
      const preferredDescription = isUsableSkillDescription(c.description) ? c.description : ownedItem.description;
      return {
        name,
        description: normalizeSkillDescription(preferredDescription || ""),
        argumentHint: c.argumentHint || "",
        source: ownedItem.source
      };
    })
    .filter((c): c is SkillItem => Boolean(c?.name))
    .sort((a, b) => a.name.localeCompare(b.name));
}

type FetchSkillsOptions = {
  buildQueryOptions: (
    workspaceRoot: string,
    settings: RuntimeSettings,
    sessionId: string,
    sdkSessionId: string | undefined
  ) => NonNullable<Parameters<typeof query>[0]["options"]>;
  withTimeout: <T>(promise: Promise<T>, timeoutMs: number, label: string) => Promise<T>;
};

export async function fetchSkills(
  workspaceRoot: string,
  settings: RuntimeSettings,
  deps: FetchSkillsOptions
): Promise<SkillItem[]> {
  const key = skillsCacheKey(workspaceRoot, settings);
  const now = Date.now();
  const ttlMs = skillsCacheTtlMs();
  if (skillsCache && skillsCache.key === key && skillsCache.expiresAt > now) {
    return skillsCache.items;
  }
  const owned = await collectOwnedSkills(workspaceRoot);
  if (owned.length === 0) {
    skillsCache = { key, workspaceRoot, items: [], expiresAt: now + ttlMs };
    return [];
  }

  const sessionId = randomUUID();
  const options = deps.buildQueryOptions(workspaceRoot, settings, sessionId, undefined);
  const queryInstance = query({
    prompt: "List available slash commands.",
    options
  });

  try {
    const commands = await deps.withTimeout(queryInstance.supportedCommands(), 5000, "supportedCommands");
    const items = normalizeSkills(commands, owned);
    skillsCache = { key, workspaceRoot, items, expiresAt: now + ttlMs };
    return items;
  } catch {
    skillsCache = { key, workspaceRoot, items: owned, expiresAt: now + ttlMs };
    return owned;
  } finally {
    try {
      queryInstance.close();
    } catch {
      // ignore close errors
    }
  }
}
