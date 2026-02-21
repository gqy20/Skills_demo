import { describe, expect, it } from "vitest";
import { mapOpenedFileData } from "../../../src/webapp/hooks/useFileEditorActions.js";

describe("mapOpenedFileData", () => {
  it("maps api data to opened file shape", () => {
    const out = mapOpenedFileData(
      { path: "src/a.js", name: "a.js", content: "x", mtimeMs: 10, size: 2 },
      "src/a.js"
    );
    expect(out).toMatchObject({ path: "src/a.js", name: "a.js", content: "x", savedContent: "x", dirty: false, size: 2 });
  });

  it("falls back to requested path", () => {
    const out = mapOpenedFileData({}, "x/y.txt");
    expect(out.path).toBe("x/y.txt");
    expect(out.name).toBe("y.txt");
  });
});
