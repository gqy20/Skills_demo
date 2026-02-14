import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  listWorkspaceFiles,
  loadIgnoreRules,
  normalizeRelativePath,
  resolveWorkspacePath
} from "../../../src/server/services/files.js";

const tempRoots: string[] = [];

async function makeWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "skills-demo-files-"));
  tempRoots.push(root);
  return root;
}

describe("files service", () => {
  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0, tempRoots.length).map(async (root) => {
        await import("node:fs/promises").then((fs) => fs.rm(root, { recursive: true, force: true }));
      })
    );
  });

  it("normalizes relative paths", () => {
    expect(normalizeRelativePath(" /a/b/ ")).toBe("a/b");
    expect(normalizeRelativePath("\\a\\b\\")).toBe("a/b");
    expect(normalizeRelativePath(".")).toBe("");
    expect(normalizeRelativePath(123)).toBe("");
  });

  it("prevents resolving paths outside workspace", () => {
    const root = "/tmp/workspace-root";
    expect(resolveWorkspacePath(root, "")).toBe(root);
    expect(resolveWorkspacePath(root, "../escape")).toBeNull();
  });

  it("loads default ignore rules and plain .gitignore entries", async () => {
    const root = await makeWorkspace();
    await writeFile(path.join(root, ".gitignore"), "custom-dir\n# comment\n*.log\n!keep.log\n");
    const rules = await loadIgnoreRules(root);
    expect(rules.names.has("node_modules")).toBe(true);
    expect(rules.names.has("custom-dir")).toBe(true);
    expect(rules.names.has("*.log")).toBe(false);
  });

  it("lists only visible entries and nests children when depth > 1", async () => {
    const root = await makeWorkspace();
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "node_modules/pkg"), { recursive: true });
    await writeFile(path.join(root, "src", "main.ts"), "export {};\n");
    await writeFile(path.join(root, "readme.md"), "hello\n");

    const rules = await loadIgnoreRules(root);
    const items = await listWorkspaceFiles(root, "", 2, rules);
    expect(items.map((i) => i.name)).toEqual(["src", "readme.md"]);
    expect(items[0].type).toBe("directory");
    expect(items[0].children?.[0].name).toBe("main.ts");
  });

  it("throws for non-directory paths", async () => {
    const root = await makeWorkspace();
    await writeFile(path.join(root, "a.txt"), "x");
    const rules = await loadIgnoreRules(root);
    await expect(listWorkspaceFiles(root, "a.txt", 1, rules)).rejects.toThrow("path must be directory");
  });
});
