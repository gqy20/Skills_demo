import type { Express, Response } from "express";
import type { RuntimeSettings } from "../types.js";
import { writeSseData } from "../services/chat.js";
import { type StoredToolTrace } from "../services/sessions.js";
import { type PendingRequestStore } from "../services/pending.js";
import { type WorkspaceRegistry } from "../services/workspaces.js";
import { type SessionRuntimeManager } from "../services/session-runtime.js";

export type ChatRoutesDeps = {
  app: Express;
  workspaceRegistry: WorkspaceRegistry;
  pendingStore: PendingRequestStore;
  defaultSettings: RuntimeSettings;
  sessionMap: Map<string, string>;
  sessionSeedMap: Map<string, string>;
  activeQueries?: Map<
    string,
    {
      interrupt?: () => Promise<void>;
      mcpServerStatus?: () => Promise<unknown[]>;
      toggleMcpServer?: (name: string, enabled: boolean) => Promise<void>;
      accountInfo?: () => Promise<{ email?: string; organization?: string }>;
      supportedModels?: () => Promise<unknown[]>;
      initializationResult?: () => Promise<{ commands?: unknown[]; models?: unknown[] }>;
      close?: () => void;
    }
  >;
  sessionRuntimeManager?: SessionRuntimeManager;
};

export type MutableTurnTrace = StoredToolTrace & {
  _seenUseIds: Set<string>;
  _lastToolLabel: string;
};

export function createTurnTrace(now = Date.now()): MutableTurnTrace {
  return {
    startedAt: now,
    completedAt: 0,
    skills: {},
    tools: {},
    phases: [{ phase: "queued", at: now }],
    actions: [],
    _seenUseIds: new Set<string>(),
    _lastToolLabel: ""
  };
}

export function sessionKey(workspaceId: string, sessionId: string): string {
  return `${workspaceId}:${sessionId}`;
}

export function logTrace(traceId: string, phase: string, data: Record<string, unknown> = {}): void {
  const line = {
    ts: new Date().toISOString(),
    traceId,
    phase,
    ...data
  };
  console.log(JSON.stringify(line));
}

export function isAskUserQuestionTool(toolName: string): boolean {
  return toolName.trim().toLowerCase() === "askuserquestion";
}

export function normalizeToolLabel(toolName: unknown): string {
  const raw = String(toolName || "").trim();
  if (!raw) return "unknown_tool";
  if (raw.startsWith("mcp__")) {
    const parts = raw.split("__").filter(Boolean);
    if (parts.length >= 3) return `${parts[1]}.${parts.slice(2).join("__")}`;
  }
  if (raw.startsWith("mcp:")) {
    const parts = raw.split(":");
    if (parts.length >= 3) return `${parts[1]}.${parts.slice(2).join(":")}`;
  }
  return raw;
}

export function writeDebugSse(
  res: Response,
  closed: boolean,
  enabled: boolean,
  traceId: string,
  phase: string,
  data: Record<string, unknown> = {}
): void {
  logTrace(traceId, phase, data);
  if (!enabled || closed) return;
  writeSseData(res, {
    type: "data-debug",
    data: {
      traceId,
      phase,
      ...data
    }
  });
}
