import { describe, expect, it } from "vitest";
import { buildTraceMapFromMessages, findLastUserTextFromMessages } from "../../../src/webapp/hooks/useSessionActions.js";

describe("useSessionActions helpers", () => {
  it("builds trace map from assistant messages", () => {
    const out = buildTraceMapFromMessages([
      { id: "u1", role: "user", parts: [{ type: "text", text: "Q" }] },
      {
        id: "a1",
        role: "assistant",
        toolTrace: { startedAt: 1, completedAt: 2, skills: { s: { count: 1 } }, tools: {}, phases: [], actions: [] }
      }
    ]);
    expect(out.a1).toMatchObject({ startedAt: 1, completedAt: 2 });
    expect(out.a1.skills).toMatchObject({ s: { count: 1 } });
  });

  it("finds last user text", () => {
    const out = findLastUserTextFromMessages([
      { id: "u1", role: "user", parts: [{ type: "text", text: " first " }] },
      { id: "a1", role: "assistant", parts: [{ type: "text", text: "ok" }] },
      { id: "u2", role: "user", parts: [{ type: "text", text: " second " }] }
    ]);
    expect(out).toBe("second");
  });
});
