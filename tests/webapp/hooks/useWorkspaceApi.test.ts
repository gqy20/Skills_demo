import { describe, expect, it } from "vitest";
import { buildWorkspaceApiPath } from "../../../src/webapp/hooks/useWorkspaceApi.js";

describe("buildWorkspaceApiPath", () => {
  it("appends workspaceId when provided", () => {
    const out = buildWorkspaceApiPath("/api/files", "ws-1", { depth: 2, path: "src" });
    expect(out).toContain("/api/files?");
    expect(out).toContain("workspaceId=ws-1");
    expect(out).toContain("depth=2");
    expect(out).toContain("path=src");
  });

  it("omits empty params", () => {
    const out = buildWorkspaceApiPath("/api/health", "", { a: "", b: null, c: undefined });
    expect(out).toBe("/api/health");
  });
});
