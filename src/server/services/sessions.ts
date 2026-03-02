import path from "node:path";
import { promises as fs } from "node:fs";

type StoredMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  ts: number;
  toolTrace?: StoredToolTrace;
};

export type StoredToolTrace = {
  startedAt: number;
  completedAt: number;
  skills: Record<string, { count: number }>;
  tools: Record<string, { count: number; elapsedSeconds: number }>;
  phases: Array<{ phase: string; at: number; detail?: string }>;
  actions: string[];
};

type StoredSession = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: StoredMessage[];
};

type StoredSessionsFile = {
  sessions: StoredSession[];
};

export type SessionSummary = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  lastPreview: string;
};

function sessionsFilePath(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".info", "chat-sessions.json");
}

function shortTitle(text: string): string {
  const t = String(text || "").trim().replace(/\s+/g, " ");
  if (!t) return "未命名会话";
  return t.length > 42 ? `${t.slice(0, 42)}...` : t;
}

function shortPreview(text: string): string {
  const t = String(text || "").trim().replace(/\s+/g, " ");
  if (!t) return "";
  return t.length > 90 ? `${t.slice(0, 90)}...` : t;
}

async function readSessionsFile(workspaceRoot: string): Promise<StoredSessionsFile> {
  const file = sessionsFilePath(workspaceRoot);
  try {
    const raw = await fs.readFile(file, "utf-8");
    const parsed = JSON.parse(raw) as Partial<StoredSessionsFile>;
    const sessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
    return {
      sessions: sessions.filter(
        (s): s is StoredSession =>
          Boolean(s && typeof s.id === "string" && Array.isArray((s as StoredSession).messages))
      )
    };
  } catch {
    return { sessions: [] };
  }
}

async function writeSessionsFile(workspaceRoot: string, data: StoredSessionsFile): Promise<void> {
  const file = sessionsFilePath(workspaceRoot);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf-8");
}

export async function appendSessionTurn(
  workspaceRoot: string,
  sessionId: string,
  userText: string,
  assistantText: string,
  assistantToolTrace?: StoredToolTrace | null
): Promise<void> {
  if (!sessionId) return;
  const now = Date.now();
  const data = await readSessionsFile(workspaceRoot);
  const sessions = data.sessions;
  const found = sessions.find((s) => s.id === sessionId);
  const nextUser: StoredMessage = {
    id: `u-${now}`,
    role: "user",
    text: String(userText || "").trim(),
    ts: now
  };
  const nextAssistant: StoredMessage = {
    id: `a-${now + 1}`,
    role: "assistant",
    text: String(assistantText || "").trim(),
    ts: now + 1,
    toolTrace: assistantToolTrace || undefined
  };

  if (found) {
    found.updatedAt = now;
    found.messages.push(nextUser, nextAssistant);
    if (found.messages.length > 200) {
      found.messages = found.messages.slice(-200);
    }
  } else {
    sessions.push({
      id: sessionId,
      title: shortTitle(userText),
      createdAt: now,
      updatedAt: now,
      messages: [nextUser, nextAssistant]
    });
  }

  sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  if (sessions.length > 80) {
    sessions.splice(80);
  }

  await writeSessionsFile(workspaceRoot, { sessions });
}

export async function listSessionSummaries(workspaceRoot: string): Promise<SessionSummary[]> {
  const data = await readSessionsFile(workspaceRoot);
  return data.sessions
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((s) => ({
      id: s.id,
      title: s.title || "未命名会话",
      createdAt: s.createdAt || 0,
      updatedAt: s.updatedAt || 0,
      messageCount: Array.isArray(s.messages) ? s.messages.length : 0,
      lastPreview: shortPreview((s.messages || []).filter((m) => m.role === "assistant").slice(-1)[0]?.text || "")
    }));
}

export async function deleteSession(workspaceRoot: string, sessionId: string): Promise<boolean> {
  const data = await readSessionsFile(workspaceRoot);
  const before = data.sessions.length;
  data.sessions = data.sessions.filter((s) => s.id !== sessionId);
  if (data.sessions.length === before) return false;
  await writeSessionsFile(workspaceRoot, data);
  return true;
}

export async function readSessionMessages(workspaceRoot: string, sessionId: string): Promise<StoredMessage[] | null> {
  const data = await readSessionsFile(workspaceRoot);
  const found = data.sessions.find((s) => s.id === sessionId);
  if (!found) return null;
  return (found.messages || []).map((m) => ({
    id: String(m.id || ""),
    role: m.role === "assistant" ? "assistant" : "user",
    text: String(m.text || ""),
    ts: Number(m.ts || 0),
    toolTrace:
      m.toolTrace && typeof m.toolTrace === "object"
        ? {
            startedAt: Number(m.toolTrace.startedAt || 0),
            completedAt: Number(m.toolTrace.completedAt || 0),
            skills: typeof m.toolTrace.skills === "object" && m.toolTrace.skills ? m.toolTrace.skills : {},
            tools: typeof m.toolTrace.tools === "object" && m.toolTrace.tools ? m.toolTrace.tools : {},
            phases: Array.isArray(m.toolTrace.phases) ? m.toolTrace.phases : [],
            actions: Array.isArray(m.toolTrace.actions) ? m.toolTrace.actions : []
          }
        : undefined
  }));
}
