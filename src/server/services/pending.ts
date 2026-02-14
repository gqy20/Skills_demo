import { randomUUID } from "node:crypto";
import type { PermissionResult, PermissionUpdate } from "@anthropic-ai/claude-agent-sdk";

export type PendingRequestKind = "ask_user_question" | "permission_request";

export type PendingNotify = (eventType: string, data: Record<string, unknown>) => void;

type PendingRequest = {
  requestId: string;
  sessionId: string;
  toolName: string;
  kind: PendingRequestKind;
  toolUseID?: string;
  input: Record<string, unknown>;
  createdAt: number;
  expiresAt: number;
  status: "pending" | "allow" | "deny" | "timeout" | "canceled";
  suggestions?: PermissionUpdate[];
  notify: PendingNotify;
  resolve: (decision: PermissionResult) => void;
  timeout: NodeJS.Timeout;
};

type RequestResolutionRecord = {
  requestId: string;
  sessionId: string;
  toolName: string;
  kind: PendingRequestKind;
  status: Exclude<PendingRequest["status"], "pending">;
  resolvedAt: number;
};

type LookupState = {
  pending: PendingRequest | null;
  resolved: RequestResolutionRecord | null;
};

export type ResolveInputResult =
  | { type: "resolved"; requestId: string; status: Exclude<PendingRequest["status"], "pending"> }
  | { type: "validation_error"; message: string }
  | { type: "not_found" }
  | { type: "idempotent"; requestId: string; status: Exclude<PendingRequest["status"], "pending"> };

export type CancelInputResult =
  | { type: "resolved"; requestId: string; status: Exclude<PendingRequest["status"], "pending"> }
  | { type: "not_found" }
  | { type: "idempotent"; requestId: string; status: Exclude<PendingRequest["status"], "pending"> };

function lifecycleEventType(kind: PendingRequestKind, phase: "created" | "resolved" | "timeout" | "canceled"): string {
  return kind === "ask_user_question" ? `data-ask-user-question-${phase}` : `data-permission-request-${phase}`;
}

export class PendingRequestStore {
  private pendingRequests = new Map<string, PendingRequest>();
  private resolvedRequests = new Map<string, RequestResolutionRecord>();

  private upsertResolvedRequest(record: RequestResolutionRecord): void {
    this.resolvedRequests.set(record.requestId, record);
    if (this.resolvedRequests.size > 2000) {
      const oldest = this.resolvedRequests.keys().next().value;
      if (oldest) this.resolvedRequests.delete(oldest);
    }
  }

  private lookupRequestState(requestId: string): LookupState {
    const pending = this.pendingRequests.get(requestId) || null;
    if (pending) return { pending, resolved: null };
    const resolved = this.resolvedRequests.get(requestId) || null;
    return { pending: null, resolved };
  }

  createPendingRequest(
    kind: PendingRequestKind,
    sessionId: string,
    toolName: string,
    input: Record<string, unknown>,
    toolUseID: string | undefined,
    notify: PendingNotify,
    suggestions?: PermissionUpdate[],
    timeoutMs = 5 * 60 * 1000
  ): { requestId: string; createdAt: number; expiresAt: number; decisionPromise: Promise<PermissionResult> } {
    const requestId = randomUUID();
    const createdAt = Date.now();
    const expiresAt = createdAt + timeoutMs;

    const decisionPromise = new Promise<PermissionResult>((resolve) => {
      const timeout = setTimeout(() => {
        const pending = this.pendingRequests.get(requestId);
        if (!pending || pending.status !== "pending") return;
        pending.status = "timeout";
        this.pendingRequests.delete(requestId);
        this.upsertResolvedRequest({
          requestId,
          sessionId,
          toolName,
          kind,
          status: "timeout",
          resolvedAt: Date.now()
        });
        notify(lifecycleEventType(kind, "timeout"), {
          requestId,
          sessionId,
          toolName,
          toolUseID,
          status: "timeout",
          expiresAt
        });
        resolve({
          behavior: "deny",
          message: "Timed out waiting for user input."
        });
      }, timeoutMs);

      this.pendingRequests.set(requestId, {
        requestId,
        sessionId,
        toolName,
        kind,
        toolUseID,
        input,
        createdAt,
        expiresAt,
        status: "pending",
        suggestions,
        notify,
        resolve,
        timeout
      });
    });

    return { requestId, createdAt, expiresAt, decisionPromise };
  }

  notifyCreated(requestId: string): void {
    const pending = this.pendingRequests.get(requestId);
    if (!pending) return;
    pending.notify(lifecycleEventType(pending.kind, "created"), {
      requestId: pending.requestId,
      sessionId: pending.sessionId,
      toolName: pending.toolName,
      kind: pending.kind,
      input: pending.input,
      suggestions: pending.suggestions,
      toolUseID: pending.toolUseID,
      createdAt: pending.createdAt,
      expiresAt: pending.expiresAt
    });
  }

  resolveInput(
    requestId: string,
    behavior: "allow" | "deny",
    message: string,
    updatedInput: unknown,
    alwaysAllow: boolean
  ): ResolveInputResult {
    const { pending, resolved } = this.lookupRequestState(requestId);
    if (!pending) {
      if (resolved) return { type: "idempotent", requestId, status: resolved.status };
      return { type: "not_found" };
    }

    if (updatedInput !== undefined && (!updatedInput || typeof updatedInput !== "object")) {
      return { type: "validation_error", message: "updatedInput must be an object when provided" };
    }

    if (
      pending.kind === "ask_user_question" &&
      updatedInput &&
      "answers" in (updatedInput as Record<string, unknown>) &&
      (typeof (updatedInput as Record<string, unknown>).answers !== "object" ||
        (updatedInput as Record<string, unknown>).answers === null ||
        Array.isArray((updatedInput as Record<string, unknown>).answers))
    ) {
      return { type: "validation_error", message: "updatedInput.answers must be an object" };
    }

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(requestId);

    if (behavior === "deny") {
      pending.status = "deny";
      this.upsertResolvedRequest({
        requestId: pending.requestId,
        sessionId: pending.sessionId,
        toolName: pending.toolName,
        kind: pending.kind,
        status: "deny",
        resolvedAt: Date.now()
      });
      pending.notify(lifecycleEventType(pending.kind, "resolved"), {
        requestId: pending.requestId,
        sessionId: pending.sessionId,
        toolName: pending.toolName,
        kind: pending.kind,
        toolUseID: pending.toolUseID,
        status: "deny",
        message
      });
      pending.resolve({ behavior: "deny", message });
    } else {
      pending.status = "allow";
      this.upsertResolvedRequest({
        requestId: pending.requestId,
        sessionId: pending.sessionId,
        toolName: pending.toolName,
        kind: pending.kind,
        status: "allow",
        resolvedAt: Date.now()
      });
      pending.notify(lifecycleEventType(pending.kind, "resolved"), {
        requestId: pending.requestId,
        sessionId: pending.sessionId,
        toolName: pending.toolName,
        kind: pending.kind,
        toolUseID: pending.toolUseID,
        status: "allow"
      });
      pending.resolve({
        behavior: "allow",
        updatedInput:
          updatedInput && typeof updatedInput === "object"
            ? (updatedInput as Record<string, unknown>)
            : pending.input,
        updatedPermissions: alwaysAllow && Array.isArray(pending.suggestions) ? pending.suggestions : undefined
      });
    }

    return { type: "resolved", requestId, status: pending.status };
  }

  cancelInput(requestId: string, message: string): CancelInputResult {
    const { pending, resolved } = this.lookupRequestState(requestId);
    if (!pending) {
      if (resolved) return { type: "idempotent", requestId, status: resolved.status };
      return { type: "not_found" };
    }

    clearTimeout(pending.timeout);
    pending.status = "canceled";
    this.pendingRequests.delete(requestId);
    this.upsertResolvedRequest({
      requestId: pending.requestId,
      sessionId: pending.sessionId,
      toolName: pending.toolName,
      kind: pending.kind,
      status: "canceled",
      resolvedAt: Date.now()
    });
    pending.notify(lifecycleEventType(pending.kind, "canceled"), {
      requestId: pending.requestId,
      sessionId: pending.sessionId,
      toolName: pending.toolName,
      kind: pending.kind,
      toolUseID: pending.toolUseID,
      status: "canceled",
      message
    });
    pending.resolve({ behavior: "deny", message });

    return { type: "resolved", requestId, status: "canceled" };
  }
}
