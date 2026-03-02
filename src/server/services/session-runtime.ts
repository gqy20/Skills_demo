import type { SDKSession } from "@anthropic-ai/claude-agent-sdk";

export type SessionRuntimeState = "idle" | "running" | "closed";

export type SessionRuntime = {
  key: string;
  workspaceId: string;
  sessionId: string;
  session: SDKSession;
  createdAt: number;
  lastActiveAt: number;
  state: SessionRuntimeState;
};

type GetOrCreateInput = {
  workspaceId: string;
  sessionId: string;
  createSession: () => SDKSession;
  now?: () => number;
};

type AcquireTurnInput = GetOrCreateInput;

type ManagerOptions = {
  maxSessions?: number;
  idleTtlMs?: number;
};

function safeClose(runtime: SessionRuntime): void {
  try {
    runtime.session.close();
  } catch {
    // ignore close errors during cleanup paths
  }
}

export class SessionRuntimeManager {
  private readonly maxSessions: number;
  private readonly idleTtlMs: number;
  private readonly map = new Map<string, SessionRuntime>();

  constructor(options: ManagerOptions = {}) {
    this.maxSessions = Math.max(1, Math.floor(options.maxSessions ?? 100));
    this.idleTtlMs = Math.max(1_000, Math.floor(options.idleTtlMs ?? 10 * 60_000));
  }

  get(key: string): SessionRuntime | null {
    return this.map.get(key) || null;
  }

  getOrCreate(input: GetOrCreateInput): { runtime: SessionRuntime; created: boolean } {
    const now = input.now ? input.now() : Date.now();
    const key = `${input.workspaceId}:${input.sessionId}`;
    const existing = this.map.get(key);
    if (existing && existing.state !== "closed") {
      existing.lastActiveAt = now;
      return { runtime: existing, created: false };
    }

    this.ensureCapacity();
    const session = input.createSession();
    const runtime: SessionRuntime = {
      key,
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      session,
      createdAt: now,
      lastActiveAt: now,
      state: "idle"
    };
    this.map.set(key, runtime);
    return { runtime, created: true };
  }

  beginTurn(key: string, now = Date.now()): boolean {
    const runtime = this.map.get(key);
    if (!runtime || runtime.state === "closed") return false;
    if (runtime.state === "running") return false;
    runtime.state = "running";
    runtime.lastActiveAt = now;
    return true;
  }

  acquireTurn(input: AcquireTurnInput): { runtime: SessionRuntime; created: boolean; acquired: boolean } {
    const nowFn = input.now;
    const now = nowFn ? nowFn() : Date.now();
    const created = this.getOrCreate({ ...input, now: nowFn });
    if (created.runtime.state === "running") {
      return { runtime: created.runtime, created: created.created, acquired: false };
    }
    created.runtime.state = "running";
    created.runtime.lastActiveAt = now;
    return { runtime: created.runtime, created: created.created, acquired: true };
  }

  endTurn(key: string, now = Date.now()): void {
    const runtime = this.map.get(key);
    if (!runtime || runtime.state === "closed") return;
    runtime.state = "idle";
    runtime.lastActiveAt = now;
  }

  touch(key: string, now = Date.now()): void {
    const runtime = this.map.get(key);
    if (!runtime || runtime.state === "closed") return;
    runtime.lastActiveAt = now;
  }

  close(key: string): boolean {
    const runtime = this.map.get(key);
    if (!runtime) return false;
    this.map.delete(key);
    runtime.state = "closed";
    safeClose(runtime);
    return true;
  }

  closeAll(): number {
    const keys = Array.from(this.map.keys());
    for (const key of keys) this.close(key);
    return keys.length;
  }

  closeIdle(now = Date.now()): number {
    let closed = 0;
    for (const [key, runtime] of this.map) {
      if (runtime.state !== "idle") continue;
      if (now - runtime.lastActiveAt < this.idleTtlMs) continue;
      this.close(key);
      closed += 1;
    }
    return closed;
  }

  private ensureCapacity(): void {
    if (this.map.size < this.maxSessions) return;
    const candidates = Array.from(this.map.values())
      .filter((runtime) => runtime.state === "idle")
      .sort((a, b) => a.lastActiveAt - b.lastActiveAt);
    const evicted = candidates[0];
    if (!evicted) {
      throw new Error("session runtime capacity reached");
    }
    this.close(evicted.key);
  }
}
