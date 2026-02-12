import { randomUUID } from "node:crypto";
import {
  unstable_v2_createSession,
  unstable_v2_resumeSession,
  type SDKMessage,
  type SDKSession
} from "@anthropic-ai/claude-agent-sdk";

type InflightRequest = {
  onEvent: (event: SDKMessage) => void;
  resolve: () => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

export class AgentClient {
  private readonly session: SDKSession;
  private inflight?: InflightRequest;
  private ended = false;
  private readonly pumpTask: Promise<void>;

  private constructor(session: SDKSession) {
    this.session = session;
    this.pumpTask = this.startPump();
  }

  static create(): AgentClient {
    const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";
    const session = unstable_v2_createSession({
      model,
      env: process.env as Record<string, string | undefined>
    });
    return new AgentClient(session);
  }

  static resume(sessionId: string): AgentClient {
    const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";
    const session = unstable_v2_resumeSession(sessionId, {
      model,
      env: process.env as Record<string, string | undefined>
    });
    return new AgentClient(session);
  }

  async send(message: string, onEvent: (event: SDKMessage) => void, timeoutMs = 10 * 60 * 1000): Promise<void> {
    if (this.ended) {
      throw new Error("session already closed");
    }
    if (this.inflight) {
      throw new Error("another request is already in progress for this session");
    }

    await this.session.send(message);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.inflight = undefined;
        reject(new Error("request timed out waiting for result"));
      }, timeoutMs);

      this.inflight = {
        onEvent,
        resolve: () => {
          clearTimeout(timeout);
          resolve();
        },
        reject: (error: Error) => {
          clearTimeout(timeout);
          reject(error);
        },
        timeout
      };
    });
  }

  close(): void {
    if (this.ended) return;
    this.ended = true;
    this.session.close();
  }

  getSessionId(): string {
    return this.session.sessionId;
  }

  private async startPump(): Promise<void> {
    try {
      for await (const event of this.session.stream()) {
        if (!this.inflight) continue;

        this.inflight.onEvent(event);

        if (event.type === "result") {
          const req = this.inflight;
          this.inflight = undefined;
          req.resolve();
        }
      }

      if (this.inflight) {
        const req = this.inflight;
        this.inflight = undefined;
        req.reject(new Error("session stream ended before result"));
      }
      this.ended = true;
    } catch (error) {
      if (this.inflight) {
        const req = this.inflight;
        this.inflight = undefined;
        req.reject(error instanceof Error ? error : new Error(String(error)));
      }
      this.ended = true;
    }
  }
}

export class AgentClientManager {
  private readonly sessions = new Map<string, AgentClient>();

  createSession(): { sessionId: string; client: AgentClient } {
    const localId = randomUUID();
    const client = AgentClient.create();
    this.sessions.set(localId, client);
    return { sessionId: localId, client };
  }

  getSession(sessionId: string): AgentClient | undefined {
    return this.sessions.get(sessionId);
  }

  getOrCreate(sessionId?: string): { sessionId: string; client: AgentClient } {
    if (!sessionId) {
      return this.createSession();
    }

    const existing = this.sessions.get(sessionId);
    if (!existing) {
      throw new Error(`session not found: ${sessionId}`);
    }
    return { sessionId, client: existing };
  }

  closeSession(sessionId: string): boolean {
    const client = this.sessions.get(sessionId);
    if (!client) return false;
    client.close();
    this.sessions.delete(sessionId);
    return true;
  }
}
