import type { RuntimeSettings, SkillItem } from "../types.js";

type SlashCacheEntry = {
  key: string;
  workspaceRoot: string;
  names: Set<string>;
  expiresAt: number;
  updatedAt: number;
};

type ResolveSlashNamesDeps = {
  fetchSkills: (workspaceRoot: string, settings: RuntimeSettings) => Promise<SkillItem[]>;
  now?: () => number;
};

export type ResolveSlashNamesResult = {
  names: Set<string> | null;
  source: "cache_fresh" | "cache_stale_on_error" | "fetched" | "unavailable";
  error: string;
};

let slashNamesCache: SlashCacheEntry | null = null;

function cacheTtlMs(): number {
  const raw = Number(process.env.AGENT_WEB_SLASH_NAMES_CACHE_TTL_MS || "");
  if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  return 60_000;
}

function makeCacheKey(workspaceRoot: string, settings: RuntimeSettings): string {
  return JSON.stringify({
    workspaceRoot,
    model: settings.model,
    baseUrl: settings.baseUrl,
    speedModeEnabled: settings.speedModeEnabled,
    mcpEnabled: settings.mcpEnabled,
    toolGateEnabled: settings.toolGateEnabled
  });
}

function normalizeSkillNames(items: SkillItem[]): Set<string> {
  return new Set(items.map((item) => String(item.name || "").trim().toLowerCase()).filter(Boolean));
}

export function clearSlashNamesCache(workspaceRoot?: string): void {
  if (!workspaceRoot) {
    slashNamesCache = null;
    return;
  }
  if (slashNamesCache?.workspaceRoot === workspaceRoot) {
    slashNamesCache = null;
  }
}

export async function resolveAvailableSlashNames(
  workspaceRoot: string,
  settings: RuntimeSettings,
  deps: ResolveSlashNamesDeps
): Promise<ResolveSlashNamesResult> {
  const now = deps.now ? deps.now() : Date.now();
  const key = makeCacheKey(workspaceRoot, settings);
  if (slashNamesCache && slashNamesCache.key === key && slashNamesCache.expiresAt > now) {
    return { names: new Set(slashNamesCache.names), source: "cache_fresh", error: "" };
  }

  try {
    const items = await deps.fetchSkills(workspaceRoot, settings);
    const names = normalizeSkillNames(items);
    const ttlMs = cacheTtlMs();
    slashNamesCache = {
      key,
      workspaceRoot,
      names: new Set(names),
      expiresAt: now + ttlMs,
      updatedAt: now
    };
    return { names, source: "fetched", error: "" };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (slashNamesCache && slashNamesCache.key === key && slashNamesCache.names.size > 0) {
      return { names: new Set(slashNamesCache.names), source: "cache_stale_on_error", error: msg };
    }
    return { names: null, source: "unavailable", error: msg };
  }
}

