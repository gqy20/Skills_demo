import path from "node:path";
import { promises as fs } from "node:fs";
import type { FileTreeItem, IgnoreRuleSet } from "../types.js";

const DEFAULT_FILE_EXCLUDES = new Set([
  ".git",
  "node_modules",
  "dist",
  "coverage",
  ".DS_Store",
  ".idea",
  ".vscode"
]);

let ignoreCache: Map<string, { loadedAt: number; rules: IgnoreRuleSet }> | null = null;

export function normalizeRelativePath(input: unknown): string {
  if (typeof input !== "string") return "";
  const cleaned = input.replaceAll("\\", "/").trim();
  if (!cleaned || cleaned === ".") return "";
  return cleaned.replace(/^\/+/, "").replace(/\/+$/, "");
}

function hasGlobPattern(value: string): boolean {
  return /[*?[\]{}]/.test(value);
}

function normalizeIgnoreEntry(raw: string): string {
  return normalizeRelativePath(raw.replace(/^\/+/, "").replace(/\/+$/, ""));
}

function makeDefaultIgnoreRules(): IgnoreRuleSet {
  const rules: IgnoreRuleSet = { prefixes: new Set(), names: new Set() };
  for (const item of DEFAULT_FILE_EXCLUDES) {
    const normalized = normalizeIgnoreEntry(item);
    if (!normalized) continue;
    if (normalized.includes("/")) rules.prefixes.add(normalized);
    else rules.names.add(normalized);
  }
  return rules;
}

export async function loadIgnoreRules(workspaceRoot: string): Promise<IgnoreRuleSet> {
  const now = Date.now();
  if (!ignoreCache) ignoreCache = new Map();
  const cached = ignoreCache.get(workspaceRoot);
  if (cached && now - cached.loadedAt < 15_000) {
    return cached.rules;
  }

  const rules = makeDefaultIgnoreRules();
  const gitignoreFile = path.join(workspaceRoot, ".gitignore");

  try {
    const raw = await fs.readFile(gitignoreFile, "utf-8");
    const lines = raw.split(/\r?\n/).map((line) => line.trim());
    for (const line of lines) {
      if (!line || line.startsWith("#")) continue;
      if (line.startsWith("!")) continue;
      if (hasGlobPattern(line)) continue;
      const normalized = normalizeIgnoreEntry(line);
      if (!normalized) continue;
      if (normalized.includes("/")) rules.prefixes.add(normalized);
      else rules.names.add(normalized);
    }
  } catch {
    // ignore missing or unreadable .gitignore
  }

  ignoreCache.set(workspaceRoot, { loadedAt: now, rules });
  return rules;
}

export function resolveWorkspacePath(workspaceRoot: string, relativePath: string): string | null {
  const abs = path.resolve(workspaceRoot, relativePath || ".");
  if (abs === workspaceRoot) return abs;
  if (!abs.startsWith(`${workspaceRoot}${path.sep}`)) return null;
  return abs;
}

function shouldExcludeEntry(relativePath: string, name: string, rules: IgnoreRuleSet): boolean {
  if (!name) return true;
  const normalizedRel = normalizeRelativePath(relativePath);
  const full = normalizedRel ? `${normalizedRel}/${name}` : name;
  if (rules.prefixes.has(full)) return true;
  if (rules.prefixes.has(name)) return true;
  if (rules.names.has(name)) return true;
  for (const prefix of rules.prefixes) {
    if (full.startsWith(`${prefix}/`)) return true;
  }
  return false;
}

async function directoryHasChildren(workspaceRoot: string, relativePath: string, rules: IgnoreRuleSet): Promise<boolean> {
  const abs = resolveWorkspacePath(workspaceRoot, relativePath);
  if (!abs) return false;
  try {
    const entries = await fs.readdir(abs, { withFileTypes: true });
    return entries.some((entry) => !shouldExcludeEntry(relativePath, entry.name, rules));
  } catch {
    return false;
  }
}

export async function listWorkspaceFiles(
  workspaceRoot: string,
  relativePath: string,
  depth: number,
  rules: IgnoreRuleSet
): Promise<FileTreeItem[]> {
  const abs = resolveWorkspacePath(workspaceRoot, relativePath);
  if (!abs) throw new Error("invalid path");

  const stat = await fs.stat(abs);
  if (!stat.isDirectory()) throw new Error("path must be directory");

  const entries = await fs.readdir(abs, { withFileTypes: true });
  const visible = entries.filter((entry) => !shouldExcludeEntry(relativePath, entry.name, rules));
  const sorted = visible.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  const items: FileTreeItem[] = [];
  for (const entry of sorted) {
    const itemPath = normalizeRelativePath(relativePath ? `${relativePath}/${entry.name}` : entry.name);
    const itemAbs = resolveWorkspacePath(workspaceRoot, itemPath);
    if (!itemAbs) continue;
    const itemStat = await fs.stat(itemAbs);
    if (entry.isDirectory()) {
      const hasChildren = await directoryHasChildren(workspaceRoot, itemPath, rules);
      const item: FileTreeItem = {
        name: entry.name,
        path: itemPath,
        type: "directory",
        size: 0,
        mtimeMs: itemStat.mtimeMs,
        hasChildren
      };
      if (depth > 1 && hasChildren) {
        item.children = await listWorkspaceFiles(workspaceRoot, itemPath, depth - 1, rules);
      }
      items.push(item);
    } else {
      items.push({
        name: entry.name,
        path: itemPath,
        type: "file",
        size: itemStat.size,
        mtimeMs: itemStat.mtimeMs
      });
    }
  }
  return items;
}
