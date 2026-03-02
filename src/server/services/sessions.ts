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

type LegacyStoredSessionsFile = {
  sessions: StoredSession[];
};

type SessionIndexItem = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  lastPreview: string;
};

type SessionIndexFile = {
  sessions: SessionIndexItem[];
};

export type SessionSummary = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  lastPreview: string;
};

const workspaceLocks = new Map<string, Promise<unknown>>();
const migrationCache = new Map<string, Promise<void>>();

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

function legacySessionsFilePath(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".info", "chat-sessions.json");
}

function sessionsRootDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".info", "chat-sessions");
}

function sessionsDataDir(workspaceRoot: string): string {
  return path.join(sessionsRootDir(workspaceRoot), "sessions");
}

function sessionIndexFilePath(workspaceRoot: string): string {
  return path.join(sessionsRootDir(workspaceRoot), "index.json");
}

function safeSessionFileName(sessionId: string): string {
  return encodeURIComponent(String(sessionId || "").trim());
}

function sessionFilePath(workspaceRoot: string, sessionId: string): string {
  return path.join(sessionsDataDir(workspaceRoot), `${safeSessionFileName(sessionId)}.json`);
}

async function fileExists(abs: string): Promise<boolean> {
  try {
    await fs.access(abs);
    return true;
  } catch {
    return false;
  }
}

function withWorkspaceLock<T>(workspaceRoot: string, fn: () => Promise<T>): Promise<T> {
  const prev = workspaceLocks.get(workspaceRoot) || Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  workspaceLocks.set(workspaceRoot, next);
  return next.finally(() => {
    if (workspaceLocks.get(workspaceRoot) === next) {
      workspaceLocks.delete(workspaceRoot);
    }
  }) as Promise<T>;
}

async function readLegacySessionsFile(workspaceRoot: string): Promise<LegacyStoredSessionsFile> {
  const file = legacySessionsFilePath(workspaceRoot);
  try {
    const raw = await fs.readFile(file, "utf-8");
    const parsed = JSON.parse(raw) as Partial<LegacyStoredSessionsFile>;
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

async function readSessionIndex(workspaceRoot: string): Promise<SessionIndexFile> {
  const file = sessionIndexFilePath(workspaceRoot);
  try {
    const raw = await fs.readFile(file, "utf-8");
    const parsed = JSON.parse(raw) as Partial<SessionIndexFile>;
    const sessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
    return {
      sessions: sessions
        .filter((s): s is SessionIndexItem => Boolean(s && typeof s.id === "string"))
        .map((s) => ({
          id: String(s.id || ""),
          title: String(s.title || "未命名会话"),
          createdAt: Number(s.createdAt || 0),
          updatedAt: Number(s.updatedAt || 0),
          messageCount: Number(s.messageCount || 0),
          lastPreview: String(s.lastPreview || "")
        }))
    };
  } catch {
    return { sessions: [] };
  }
}

async function writeSessionIndex(workspaceRoot: string, data: SessionIndexFile): Promise<void> {
  const file = sessionIndexFilePath(workspaceRoot);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf-8");
}

function normalizeStoredMessage(raw: unknown): StoredMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = String(row.id || "").trim();
  if (!id) return null;
  const role = row.role === "assistant" ? "assistant" : row.role === "user" ? "user" : null;
  if (!role) return null;
  const text = String(row.text || "");
  const ts = Number(row.ts || 0);
  const toolTraceRaw = row.toolTrace;
  let toolTrace: StoredToolTrace | undefined;
  if (toolTraceRaw && typeof toolTraceRaw === "object") {
    const t = toolTraceRaw as Record<string, unknown>;
    toolTrace = {
      startedAt: Number(t.startedAt || 0),
      completedAt: Number(t.completedAt || 0),
      skills: typeof t.skills === "object" && t.skills ? (t.skills as Record<string, { count: number }>) : {},
      tools:
        typeof t.tools === "object" && t.tools ? (t.tools as Record<string, { count: number; elapsedSeconds: number }>) : {},
      phases: Array.isArray(t.phases) ? (t.phases as Array<{ phase: string; at: number; detail?: string }>) : [],
      actions: Array.isArray(t.actions) ? (t.actions as string[]) : []
    };
  }
  return {
    id,
    role,
    text,
    ts: Number.isFinite(ts) ? ts : 0,
    ...(toolTrace ? { toolTrace } : {})
  };
}

async function readSessionFile(workspaceRoot: string, sessionId: string): Promise<StoredSession | null> {
  const file = sessionFilePath(workspaceRoot, sessionId);
  try {
    const raw = await fs.readFile(file, "utf-8");
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    const id = String(parsed.id || sessionId || "").trim();
    if (!id) return null;
    const messages = (Array.isArray(parsed.messages) ? parsed.messages : [])
      .map((item) => normalizeStoredMessage(item))
      .filter((item): item is StoredMessage => Boolean(item));
    return {
      id,
      title: String(parsed.title || "未命名会话"),
      createdAt: Number(parsed.createdAt || 0),
      updatedAt: Number(parsed.updatedAt || 0),
      messages
    };
  } catch {
    return null;
  }
}

async function writeSessionFile(workspaceRoot: string, session: StoredSession): Promise<void> {
  const file = sessionFilePath(workspaceRoot, session.id);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(session, null, 2), "utf-8");
}

function buildIndexItem(session: StoredSession): SessionIndexItem {
  return {
    id: session.id,
    title: session.title || "未命名会话",
    createdAt: Number(session.createdAt || 0),
    updatedAt: Number(session.updatedAt || 0),
    messageCount: Array.isArray(session.messages) ? session.messages.length : 0,
    lastPreview: shortPreview((session.messages || []).filter((m) => m.role === "assistant").slice(-1)[0]?.text || "")
  };
}

async function trimToSessionLimit(workspaceRoot: string, sessions: SessionIndexItem[]): Promise<SessionIndexItem[]> {
  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  const keep = sorted.slice(0, 80);
  const drop = sorted.slice(80);
  await Promise.all(
    drop.map(async (item) => {
      try {
        await fs.unlink(sessionFilePath(workspaceRoot, item.id));
      } catch {
        // ignore missing files
      }
    })
  );
  return keep;
}

async function migrateLegacyIfNeeded(workspaceRoot: string): Promise<void> {
  const indexFile = sessionIndexFilePath(workspaceRoot);
  if (await fileExists(indexFile)) return;

  const legacy = await readLegacySessionsFile(workspaceRoot);
  if (legacy.sessions.length === 0) {
    await writeSessionIndex(workspaceRoot, { sessions: [] });
    return;
  }

  await fs.mkdir(sessionsDataDir(workspaceRoot), { recursive: true });
  const nextIndex: SessionIndexItem[] = [];
  for (const legacySession of legacy.sessions) {
    const id = String(legacySession.id || "").trim();
    if (!id) continue;
    const normalized: StoredSession = {
      id,
      title: String(legacySession.title || "未命名会话"),
      createdAt: Number(legacySession.createdAt || 0),
      updatedAt: Number(legacySession.updatedAt || 0),
      messages: (Array.isArray(legacySession.messages) ? legacySession.messages : [])
        .map((item) => normalizeStoredMessage(item))
        .filter((item): item is StoredMessage => Boolean(item))
    };
    await writeSessionFile(workspaceRoot, normalized);
    nextIndex.push(buildIndexItem(normalized));
  }

  const trimmed = await trimToSessionLimit(workspaceRoot, nextIndex);
  await writeSessionIndex(workspaceRoot, { sessions: trimmed });
  try {
    await fs.unlink(legacySessionsFilePath(workspaceRoot));
  } catch {
    // ignore missing legacy file
  }
}

async function cleanupLegacyFileIfMigrated(workspaceRoot: string): Promise<void> {
  const hasIndex = await fileExists(sessionIndexFilePath(workspaceRoot));
  if (!hasIndex) return;
  try {
    await fs.unlink(legacySessionsFilePath(workspaceRoot));
  } catch {
    // ignore missing legacy file
  }
}

async function ensureStorageReady(workspaceRoot: string): Promise<void> {
  const cached = migrationCache.get(workspaceRoot);
  if (cached) {
    await cached;
    return;
  }
  const running = withWorkspaceLock(workspaceRoot, async () => {
    await migrateLegacyIfNeeded(workspaceRoot);
    await cleanupLegacyFileIfMigrated(workspaceRoot);
  });
  migrationCache.set(workspaceRoot, running);
  try {
    await running;
  } finally {
    if (migrationCache.get(workspaceRoot) === running) {
      migrationCache.delete(workspaceRoot);
    }
  }
}

export async function appendSessionTurn(
  workspaceRoot: string,
  sessionId: string,
  userText: string,
  assistantText: string,
  assistantToolTrace?: StoredToolTrace | null
): Promise<void> {
  if (!sessionId) return;
  await ensureStorageReady(workspaceRoot);
  await withWorkspaceLock(workspaceRoot, async () => {
    const now = Date.now();
    const existing = await readSessionFile(workspaceRoot, sessionId);
    const session: StoredSession = existing || {
      id: sessionId,
      title: shortTitle(userText),
      createdAt: now,
      updatedAt: now,
      messages: []
    };

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

    session.updatedAt = now;
    session.messages.push(nextUser, nextAssistant);
    if (session.messages.length > 200) {
      session.messages = session.messages.slice(-200);
    }

    await writeSessionFile(workspaceRoot, session);

    const index = await readSessionIndex(workspaceRoot);
    const next = index.sessions.filter((item) => item.id !== session.id);
    next.push(buildIndexItem(session));
    const trimmed = await trimToSessionLimit(workspaceRoot, next);
    await writeSessionIndex(workspaceRoot, { sessions: trimmed });
  });
}

export async function listSessionSummaries(workspaceRoot: string): Promise<SessionSummary[]> {
  await ensureStorageReady(workspaceRoot);
  const index = await readSessionIndex(workspaceRoot);
  return index.sessions
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((s) => ({
      id: s.id,
      title: s.title || "未命名会话",
      createdAt: Number(s.createdAt || 0),
      updatedAt: Number(s.updatedAt || 0),
      messageCount: Number(s.messageCount || 0),
      lastPreview: String(s.lastPreview || "")
    }));
}

export async function deleteSession(workspaceRoot: string, sessionId: string): Promise<boolean> {
  await ensureStorageReady(workspaceRoot);
  return withWorkspaceLock(workspaceRoot, async () => {
    const index = await readSessionIndex(workspaceRoot);
    const before = index.sessions.length;
    const next = index.sessions.filter((s) => s.id !== sessionId);
    if (next.length === before) return false;
    await writeSessionIndex(workspaceRoot, { sessions: next });
    try {
      await fs.unlink(sessionFilePath(workspaceRoot, sessionId));
    } catch {
      // ignore missing files
    }
    return true;
  });
}

export async function readSessionMessages(workspaceRoot: string, sessionId: string): Promise<StoredMessage[] | null> {
  await ensureStorageReady(workspaceRoot);
  const found = await readSessionFile(workspaceRoot, sessionId);
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
