import { describe, expect, it } from "vitest";
import {
  INITIAL_PENDING_STATE,
  resolvePendingState,
  setPendingDraftState,
  upsertPendingState
} from "../../../src/webapp/hooks/usePendingState.js";

describe("usePendingState helpers", () => {
  it("upserts pending request and sets activeId", () => {
    const next = upsertPendingState(INITIAL_PENDING_STATE, "permission_request", {
      requestId: "r1",
      toolName: "Read",
      input: { path: "a" }
    });
    expect(next.activeId).toBe("r1");
    expect(next.order).toEqual(["r1"]);
    expect(next.byId.r1.toolName).toBe("Read");
  });

  it("resolves pending request", () => {
    const s1 = upsertPendingState(INITIAL_PENDING_STATE, "permission_request", { requestId: "r1" });
    const s2 = upsertPendingState(s1, "permission_request", { requestId: "r2" });
    const s3 = resolvePendingState(s2, { requestId: "r1" });
    expect(s3.byId.r1).toBeUndefined();
    expect(s3.activeId).toBe("r2");
  });

  it("updates draft within bounds", () => {
    const s1 = upsertPendingState(INITIAL_PENDING_STATE, "ask_user_question", { requestId: "r1" });
    const s2 = setPendingDraftState(s1, "r1", 2, { index: 10, answers: { a: "b" } });
    expect(s2.drafts.r1.index).toBe(1);
    expect(s2.drafts.r1.answers).toEqual({ a: "b" });
  });
});
