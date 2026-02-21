import { describe, expect, it } from "vitest";
import { buildSkillSourceCounts, filterFilesList, filterSkillsList } from "../../../src/webapp/hooks/useSidebarDerived.js";

describe("useSidebarDerived helpers", () => {
  it("builds source counts", () => {
    const out = buildSkillSourceCounts([
      { source: "project" },
      { source: "user" },
      { source: "project" }
    ]);
    expect(out).toEqual({ all: 3, project: 2, user: 1 });
  });

  it("filters skills by source and query", () => {
    const out = filterSkillsList(
      [
        { name: "commander", description: "A", source: "project" },
        { name: "profile", description: "B", source: "user" }
      ],
      "project",
      "com"
    );
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("commander");
  });

  it("filters files by query", () => {
    const out = filterFilesList(
      [
        { name: "a.ts", path: "src/a.ts" },
        { name: "b.md", path: "docs/b.md" }
      ],
      "src"
    );
    expect(out).toHaveLength(1);
    expect(out[0].path).toBe("src/a.ts");
  });
});
