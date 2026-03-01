import { describe, expect, it } from "vitest";
import {
  extractSlashCommand,
  flattenFiles,
  formatElapsed,
  formatPhaseLabel,
  inspectEnvText,
  looksLikeToolClaim,
  normalizeSettings,
  parseMcpToolName,
  permissionProfileLabel,
  shortText,
  textFromMessage,
  toolLabel
} from "../../../src/webapp/lib/chatUtils.js";

describe("chatUtils", () => {
  it("extracts text from message parts", () => {
    const out = textFromMessage({
      parts: [
        { type: "text", text: "hello" },
        { type: "reasoning", text: "ignored" },
        { type: "text", text: " world" }
      ]
    });
    expect(out).toBe("hello world");
  });

  it("formats elapsed seconds", () => {
    expect(formatElapsed(9.2)).toBe("9s");
    expect(formatElapsed(61)).toBe("1m 1s");
  });

  it("parses slash command", () => {
    expect(extractSlashCommand("/commander start test")).toBe("commander");
    expect(extractSlashCommand("hello")).toBe("");
  });

  it("flattens file tree", () => {
    const out = flattenFiles([
      { type: "directory", name: "src", path: "src", children: [{ type: "file", name: "a.ts", path: "src/a.ts" }] }
    ]);
    expect(out.map((x) => `${x.path}:${x.level}`)).toEqual(["src:0", "src/a.ts:1"]);
  });

  it("parses mcp tool names", () => {
    expect(parseMcpToolName("mcp__paper__search")).toMatchObject({ server: "paper", tool: "search" });
    expect(parseMcpToolName("mcp:paper:search")).toMatchObject({ server: "paper", tool: "search" });
    expect(parseMcpToolName("plain_tool")).toBeNull();
  });

  it("returns labels and phase labels", () => {
    expect(toolLabel("mcp__paper__search")).toBe("paper.search");
    expect(permissionProfileLabel("full_auto")).toBe("全部允许");
    expect(formatPhaseLabel("responding")).toBe("生成回复中");
    expect(formatPhaseLabel("other")).toBe("other");
  });

  it("detects tool claims and shortens text", () => {
    expect(looksLikeToolClaim("调用 mcp 检索"));
    expect(shortText("abcdef", 4)).toBe("abcd...");
  });

  it("normalizes settings payload", () => {
    const out = normalizeSettings({
      model: "m",
      baseUrl: "u",
      permissionProfile: "accept_edits",
      hasToken: true,
      tokenPreview: "a...b"
    });
    expect(out).toMatchObject({
      model: "m",
      baseUrl: "u",
      permissionProfile: "accept_edits",
      hasToken: true,
      tokenPreview: "a...b"
    });
  });

  it("inspects env text stats", () => {
    const out = inspectEnvText("A=1\nBAD\nA=2\n#c");
    expect(out).toEqual({
      validCount: 2,
      invalidLineNumbers: [2],
      duplicateKeys: ["A"]
    });
  });
});
