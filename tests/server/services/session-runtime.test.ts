import { describe, expect, it, vi } from "vitest";
import { SessionRuntimeManager } from "../../../src/server/services/session-runtime.js";

type FakeSession = {
  close: ReturnType<typeof vi.fn>;
};

function makeSession(): FakeSession {
  return { close: vi.fn() };
}

describe("SessionRuntimeManager", () => {
  it("reuses existing runtime for the same key", () => {
    const manager = new SessionRuntimeManager({ maxSessions: 4, idleTtlMs: 60_000 });
    const createSession = vi.fn(() => makeSession() as never);
    const a = manager.getOrCreate({
      workspaceId: "ws1",
      sessionId: "s1",
      createSession
    });
    const b = manager.getOrCreate({
      workspaceId: "ws1",
      sessionId: "s1",
      createSession
    });

    expect(a.runtime.key).toBe("ws1:s1");
    expect(b.runtime.key).toBe("ws1:s1");
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
  });

  it("tracks running/idle transitions", () => {
    const manager = new SessionRuntimeManager({ maxSessions: 4, idleTtlMs: 60_000 });
    manager.getOrCreate({
      workspaceId: "ws1",
      sessionId: "s1",
      createSession: () => makeSession() as never
    });

    expect(manager.beginTurn("ws1:s1")).toBe(true);
    expect(manager.beginTurn("ws1:s1")).toBe(false);
    manager.endTurn("ws1:s1");
    expect(manager.beginTurn("ws1:s1")).toBe(true);
  });

  it("acquires turn atomically and creates runtime when missing", () => {
    const manager = new SessionRuntimeManager({ maxSessions: 4, idleTtlMs: 60_000 });
    const createSession = vi.fn(() => makeSession() as never);
    const acquired = manager.acquireTurn({
      workspaceId: "ws1",
      sessionId: "s1",
      createSession
    });
    const second = manager.acquireTurn({
      workspaceId: "ws1",
      sessionId: "s1",
      createSession
    });

    expect(acquired.created).toBe(true);
    expect(acquired.acquired).toBe(true);
    expect(second.created).toBe(false);
    expect(second.acquired).toBe(false);
    expect(createSession).toHaveBeenCalledTimes(1);
  });

  it("closes idle sessions by ttl", () => {
    const manager = new SessionRuntimeManager({ maxSessions: 4, idleTtlMs: 10_000 });
    const s1 = makeSession();
    manager.getOrCreate({
      workspaceId: "ws1",
      sessionId: "s1",
      createSession: () => s1 as never,
      now: () => 1_000
    });
    const closed = manager.closeIdle(12_000);
    expect(closed).toBe(1);
    expect(s1.close).toHaveBeenCalledOnce();
  });

  it("evicts least-recently-active idle runtime when exceeding max", () => {
    const manager = new SessionRuntimeManager({ maxSessions: 1, idleTtlMs: 60_000 });
    const s1 = makeSession();
    const s2 = makeSession();
    manager.getOrCreate({
      workspaceId: "ws1",
      sessionId: "s1",
      createSession: () => s1 as never,
      now: () => 1_000
    });
    const created = manager.getOrCreate({
      workspaceId: "ws1",
      sessionId: "s2",
      createSession: () => s2 as never,
      now: () => 2_000
    });

    expect(created.created).toBe(true);
    expect(s1.close).toHaveBeenCalledOnce();
    expect(manager.get("ws1:s1")).toBeNull();
    expect(manager.get("ws1:s2")).not.toBeNull();
  });

  it("throws when capacity reached and no idle runtime can be evicted", () => {
    const manager = new SessionRuntimeManager({ maxSessions: 1, idleTtlMs: 60_000 });
    manager.getOrCreate({
      workspaceId: "ws1",
      sessionId: "s1",
      createSession: () => makeSession() as never,
      now: () => 1_000
    });
    expect(manager.beginTurn("ws1:s1")).toBe(true);

    expect(() =>
      manager.getOrCreate({
        workspaceId: "ws1",
        sessionId: "s2",
        createSession: () => makeSession() as never,
        now: () => 2_000
      })
    ).toThrow("session runtime capacity reached");
  });
});
