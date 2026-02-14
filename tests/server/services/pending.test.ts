import { describe, expect, it, vi } from "vitest";
import { PendingRequestStore } from "../../../src/server/services/pending.js";

describe("PendingRequestStore", () => {
  it("resolves allow with updated input and optional permission updates", async () => {
    const notify = vi.fn();
    const store = new PendingRequestStore();
    const suggestions = [{ tool_name: "bash", behavior: "allow" }];
    const { requestId, decisionPromise } = store.createPendingRequest(
      "permission_request",
      "s1",
      "Bash",
      { cmd: "ls" },
      "tool-1",
      notify,
      suggestions as never
    );

    const result = store.resolveInput(requestId, "allow", "ok", { cmd: "pwd" }, true);
    expect(result).toEqual({ type: "resolved", requestId, status: "allow" });
    await expect(decisionPromise).resolves.toEqual({
      behavior: "allow",
      updatedInput: { cmd: "pwd" },
      updatedPermissions: suggestions
    });
    expect(
      notify.mock.calls.some(
        ([event, payload]) =>
          event === "data-permission-request-resolved" && (payload as Record<string, unknown>).status === "allow"
      )
    ).toBe(true);
  });

  it("returns validation error when ask_user_question answers is invalid", () => {
    const store = new PendingRequestStore();
    const { requestId } = store.createPendingRequest(
      "ask_user_question",
      "s1",
      "AskUserQuestion",
      { question: "q" },
      undefined,
      vi.fn()
    );
    const result = store.resolveInput(requestId, "allow", "", { answers: [] }, false);
    expect(result).toEqual({ type: "validation_error", message: "updatedInput.answers must be an object" });
  });

  it("supports idempotent response after resolved", () => {
    const store = new PendingRequestStore();
    const { requestId } = store.createPendingRequest(
      "permission_request",
      "s1",
      "Bash",
      { cmd: "ls" },
      undefined,
      vi.fn()
    );
    store.resolveInput(requestId, "deny", "no", undefined, false);
    const second = store.resolveInput(requestId, "allow", "ignored", undefined, false);
    expect(second).toEqual({ type: "idempotent", requestId, status: "deny" });
  });

  it("supports cancel and idempotent cancel", () => {
    const store = new PendingRequestStore();
    const { requestId } = store.createPendingRequest(
      "permission_request",
      "s1",
      "Bash",
      { cmd: "ls" },
      undefined,
      vi.fn()
    );
    expect(store.cancelInput(requestId, "stop")).toEqual({ type: "resolved", requestId, status: "canceled" });
    expect(store.cancelInput(requestId, "stop")).toEqual({ type: "idempotent", requestId, status: "canceled" });
  });

  it("times out pending request and denies by default", async () => {
    vi.useFakeTimers();
    const notify = vi.fn();
    const store = new PendingRequestStore();
    const { requestId, decisionPromise } = store.createPendingRequest(
      "permission_request",
      "s1",
      "Bash",
      { cmd: "ls" },
      "tool-1",
      notify,
      undefined,
      10
    );
    await vi.advanceTimersByTimeAsync(11);
    await expect(decisionPromise).resolves.toEqual({
      behavior: "deny",
      message: "Timed out waiting for user input."
    });
    expect(store.resolveInput(requestId, "allow", "late", undefined, false)).toEqual({
      type: "idempotent",
      requestId,
      status: "timeout"
    });
    expect(
      notify.mock.calls.some(
        ([event, payload]) =>
          event === "data-permission-request-timeout" && (payload as Record<string, unknown>).status === "timeout"
      )
    ).toBe(true);
    vi.useRealTimers();
  });
});
