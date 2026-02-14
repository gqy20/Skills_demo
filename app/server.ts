import "dotenv/config";
import express from "express";
import cors from "cors";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { query, type PermissionResult, type SDKMessage, type PermissionUpdate, type SlashCommand } from "@anthropic-ai/claude-agent-sdk";
import type { Response } from "express";

const app = express();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");
const SETTINGS_FILE = path.join(PROJECT_ROOT, ".info", "agent-web-settings.json");

type PendingRequest = {
  requestId: string;
  sessionId: string;
  toolName: string;
  kind: "ask_user_question" | "permission_request";
  toolUseID?: string;
  input: Record<string, unknown>;
  createdAt: number;
  expiresAt: number;
  status: "pending" | "allow" | "deny" | "timeout" | "canceled";
  suggestions?: PermissionUpdate[];
  notify: (eventType: string, data: Record<string, unknown>) => void;
  resolve: (decision: PermissionResult) => void;
  timeout: NodeJS.Timeout;
};

type RequestResolutionRecord = {
  requestId: string;
  sessionId: string;
  toolName: string;
  kind: PendingRequest["kind"];
  status: Exclude<PendingRequest["status"], "pending">;
  resolvedAt: number;
};

type RuntimeSettings = {
  model: string;
  baseUrl: string;
  authToken: string;
  mcpEnabled: boolean;
  speedModeEnabled: boolean;
  toolGateEnabled: boolean;
  debugEnabled: boolean;
  debugSseEnabled: boolean;
};

type ChatMessage = {
  id?: string;
  role?: string;
  content?: unknown;
  parts?: Array<{ type?: string; text?: string }>;
};

type SkillItem = {
  name: string;
  description: string;
  argumentHint: string;
  source: "project" | "user";
};

const pendingRequests = new Map<string, PendingRequest>();
const resolvedRequests = new Map<string, RequestResolutionRecord>();
const sessionMap = new Map<string, string>();
const sessionSeedMap = new Map<string, string>();
const activeQueries = new Map<string, ReturnType<typeof query>>();
let skillsCache:
  | {
      key: string;
      expiresAt: number;
      items: SkillItem[];
    }
  | null = null;

const DEFAULT_SETTINGS: RuntimeSettings = {
  model: process.env.ANTHROPIC_MODEL || "glm-5",
  baseUrl: process.env.ANTHROPIC_BASE_URL || "https://open.bigmodel.cn/api/anthropic",
  authToken: process.env.ANTHROPIC_AUTH_TOKEN || "",
  mcpEnabled: true,
  speedModeEnabled: false,
  toolGateEnabled: true,
  debugEnabled: process.env.AGENT_WEB_DEBUG === "1",
  debugSseEnabled: process.env.AGENT_WEB_DEBUG_SSE === "1"
};

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(__dirname));

function extractText(value: unknown): string[] {
  if (typeof value === "string") {
    const t = value.trim();
    return t ? [t] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => extractText(item));
  }
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    const texts: string[] = [];
    if (typeof v.text === "string") texts.push(...extractText(v.text));
    if (v.content !== undefined) texts.push(...extractText(v.content));
    if (v.message !== undefined) texts.push(...extractText(v.message));
    if (v.result !== undefined) texts.push(...extractText(v.result));
    return texts;
  }
  return [];
}

function extractPrompt(messages: unknown): string {
  if (!Array.isArray(messages)) return "";

  const list = messages as ChatMessage[];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const msg = list[i];
    if (msg?.role !== "user") continue;

    const partTexts = Array.isArray(msg.parts)
      ? msg.parts.filter((p) => p?.type === "text").map((p) => p.text || "")
      : [];
    const fromParts = extractText(partTexts).join("\n").trim();
    if (fromParts) return fromParts;

    const fromContent = extractText(msg.content).join("\n").trim();
    if (fromContent) return fromContent;
  }

  return "";
}

function extractDeltaText(event: SDKMessage): string {
  if (event.type !== "stream_event") return "";
  const raw = event.event as Record<string, unknown>;
  if (raw.type !== "content_block_delta") return "";
  const delta = raw.delta as Record<string, unknown> | undefined;
  if (!delta || delta.type !== "text_delta") return "";
  return typeof delta.text === "string" ? delta.text : "";
}

function writeSseData(res: Response, data: unknown): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function writeSseDone(res: Response): void {
  res.write("data: [DONE]\n\n");
}

function lifecycleEventType(kind: PendingRequest["kind"], phase: "created" | "resolved" | "timeout" | "canceled"): string {
  return kind === "ask_user_question" ? `data-ask-user-question-${phase}` : `data-permission-request-${phase}`;
}

function upsertResolvedRequest(record: RequestResolutionRecord): void {
  resolvedRequests.set(record.requestId, record);
  if (resolvedRequests.size > 2000) {
    const oldest = resolvedRequests.keys().next().value;
    if (oldest) resolvedRequests.delete(oldest);
  }
}

function logTrace(traceId: string, phase: string, data: Record<string, unknown> = {}): void {
  const line = {
    ts: new Date().toISOString(),
    traceId,
    phase,
    ...data
  };
  console.log(JSON.stringify(line));
}

function writeDebugSse(
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

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function createPendingRequest(
  kind: PendingRequest["kind"],
  sessionId: string,
  toolName: string,
  input: Record<string, unknown>,
  toolUseID: string | undefined,
  notify: PendingRequest["notify"],
  suggestions?: PermissionUpdate[],
  timeoutMs = 5 * 60 * 1000
): { requestId: string; decisionPromise: Promise<PermissionResult> } {
  const requestId = randomUUID();
  const createdAt = Date.now();
  const expiresAt = createdAt + timeoutMs;

  const decisionPromise = new Promise<PermissionResult>((resolve) => {
    const timeout = setTimeout(() => {
      const pending = pendingRequests.get(requestId);
      if (!pending || pending.status !== "pending") return;
      pending.status = "timeout";
      pendingRequests.delete(requestId);
      upsertResolvedRequest({
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

    pendingRequests.set(requestId, {
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

  return { requestId, decisionPromise };
}

async function readSettings(): Promise<RuntimeSettings> {
  try {
    const raw = await fs.readFile(SETTINGS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<RuntimeSettings>;
    return {
      model: parsed.model || DEFAULT_SETTINGS.model,
      baseUrl: parsed.baseUrl || DEFAULT_SETTINGS.baseUrl,
      authToken: parsed.authToken || DEFAULT_SETTINGS.authToken,
      mcpEnabled: typeof parsed.mcpEnabled === "boolean" ? parsed.mcpEnabled : DEFAULT_SETTINGS.mcpEnabled,
      speedModeEnabled:
        typeof parsed.speedModeEnabled === "boolean" ? parsed.speedModeEnabled : DEFAULT_SETTINGS.speedModeEnabled,
      toolGateEnabled:
        typeof parsed.toolGateEnabled === "boolean" ? parsed.toolGateEnabled : DEFAULT_SETTINGS.toolGateEnabled,
      debugEnabled:
        typeof parsed.debugEnabled === "boolean" ? parsed.debugEnabled : DEFAULT_SETTINGS.debugEnabled,
      debugSseEnabled:
        typeof parsed.debugSseEnabled === "boolean" ? parsed.debugSseEnabled : DEFAULT_SETTINGS.debugSseEnabled
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

async function writeSettings(settings: RuntimeSettings): Promise<void> {
  await fs.mkdir(path.dirname(SETTINGS_FILE), { recursive: true });
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf-8");
}

async function getMcpServerNames(): Promise<string[]> {
  try {
    const raw = await fs.readFile(path.join(PROJECT_ROOT, ".mcp.json"), "utf-8");
    const parsed = JSON.parse(raw) as { mcpServers?: Record<string, unknown> };
    return Object.keys(parsed.mcpServers || {});
  } catch {
    return [];
  }
}

async function applyMcpToggle(queryInstance: ReturnType<typeof query>, enabled: boolean): Promise<void> {
  const names = await getMcpServerNames();
  for (const name of names) {
    try {
      await queryInstance.toggleMcpServer(name, enabled);
    } catch {
      // Ignore individual MCP toggle errors to keep stream path resilient.
    }
  }
}

function buildQueryEnv(settings: RuntimeSettings): Record<string, string | undefined> {
  return {
    ...process.env,
    ANTHROPIC_MODEL: settings.model,
    ANTHROPIC_BASE_URL: settings.baseUrl,
    ANTHROPIC_AUTH_TOKEN: settings.authToken
  };
}

function buildQueryOptions(
  settings: RuntimeSettings,
  sessionId: string,
  sdkSessionId: string | undefined,
  extra: Partial<Parameters<typeof query>[0]["options"]> = {}
): NonNullable<Parameters<typeof query>[0]["options"]> {
  const base: NonNullable<Parameters<typeof query>[0]["options"]> = {
    cwd: process.cwd(),
    env: buildQueryEnv(settings),
    ...(sdkSessionId ? { resume: sdkSessionId } : { sessionId }),
    ...extra
  };

  if (settings.speedModeEnabled) {
    base.settingSources = [];
    base.thinking = { type: "disabled" };
    base.includePartialMessages = true;
  } else {
    base.settingSources = ["project"];
  }

  return base;
}

function maskToken(token: string): string {
  if (!token) return "";
  if (token.length <= 8) return "********";
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

function skillsCacheKey(settings: RuntimeSettings): string {
  return JSON.stringify({
    speedModeEnabled: settings.speedModeEnabled,
    mcpEnabled: settings.mcpEnabled,
    toolGateEnabled: settings.toolGateEnabled
  });
}

function normalizeSkillName(name: string): string {
  return name.trim().toLowerCase();
}

function summarizeSkillMarkdown(raw: string): string {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    if (line.startsWith("#")) continue;
    if (line.startsWith("```")) continue;
    return line.replace(/^[-*]\s+/, "").slice(0, 220);
  }
  return "";
}

async function collectLocalSkills(baseDir: string, source: SkillItem["source"]): Promise<SkillItem[]> {
  const items: SkillItem[] = [];
  try {
    const entries = await fs.readdir(baseDir, { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        if (!entry.isDirectory()) return;
        const skillFile = path.join(baseDir, entry.name, "SKILL.md");
        try {
          const raw = await fs.readFile(skillFile, "utf-8");
          items.push({
            name: normalizeSkillName(entry.name),
            description: summarizeSkillMarkdown(raw),
            argumentHint: "",
            source
          });
        } catch {
          // Ignore folders without SKILL.md
        }
      })
    );
  } catch {
    // Ignore missing or unreadable skill directory.
  }
  return items;
}

async function collectOwnedSkills(): Promise<SkillItem[]> {
  const projectDir = path.join(PROJECT_ROOT, ".claude", "skills");
  const userDir = path.join(os.homedir(), ".claude", "skills");
  const [projectItems, userItems] = await Promise.all([
    collectLocalSkills(projectDir, "project"),
    collectLocalSkills(userDir, "user")
  ]);
  const map = new Map<string, SkillItem>();
  for (const item of userItems) map.set(item.name, item);
  for (const item of projectItems) map.set(item.name, item);
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function normalizeSkills(commands: SlashCommand[], owned: SkillItem[]): SkillItem[] {
  const ownedMap = new Map<string, SkillItem>(owned.map((item) => [item.name, item]));
  return commands
    .map((c) => {
      const name = c.name || "";
      const normalized = normalizeSkillName(name);
      const ownedItem = ownedMap.get(normalized);
      if (!ownedItem) return null;
      return {
        name,
        description: c.description || ownedItem.description || "",
        argumentHint: c.argumentHint || "",
        source: ownedItem.source
      };
    })
    .filter((c): c is SkillItem => Boolean(c?.name))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function fetchSkills(settings: RuntimeSettings): Promise<SkillItem[]> {
  const key = skillsCacheKey(settings);
  const now = Date.now();
  if (skillsCache && skillsCache.key === key && skillsCache.expiresAt > now) {
    return skillsCache.items;
  }

  const sessionId = randomUUID();
  const options = buildQueryOptions(settings, sessionId, undefined);
  const queryInstance = query({
    prompt: "List available slash commands.",
    options
  });

  try {
    const owned = await collectOwnedSkills();
    if (owned.length === 0) {
      skillsCache = { key, items: [], expiresAt: now + 30_000 };
      return [];
    }
    const commands = await withTimeout(queryInstance.supportedCommands(), 5000, "supportedCommands");
    const items = normalizeSkills(commands, owned);
    skillsCache = { key, items, expiresAt: now + 30_000 };
    return items;
  } catch {
    const fallback = await collectOwnedSkills();
    skillsCache = { key, items: fallback, expiresAt: now + 30_000 };
    return fallback;
  } finally {
    try {
      queryInstance.close();
    } catch {
      // ignore close errors
    }
  }
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, transport: "ui-message-stream", askQuestion: true });
});

app.get("/api/settings", async (_req, res) => {
  const settings = await readSettings();
  res.json({
    model: settings.model,
    baseUrl: settings.baseUrl,
    mcpEnabled: settings.mcpEnabled,
    speedModeEnabled: settings.speedModeEnabled,
    toolGateEnabled: settings.toolGateEnabled,
    debugEnabled: settings.debugEnabled,
    debugSseEnabled: settings.debugSseEnabled,
    hasToken: Boolean(settings.authToken),
    tokenPreview: maskToken(settings.authToken)
  });
});

app.get("/api/skills", async (_req, res) => {
  try {
    const settings = await readSettings();
    const items = await fetchSkills(settings);
    res.json({
      ok: true,
      count: items.length,
      source: "claude-agent-sdk-supportedCommands+local-owned-filter",
      items
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ ok: false, error: msg, items: [] });
  }
});

app.post("/api/settings", async (req, res) => {
  const current = await readSettings();
  const model = typeof req.body?.model === "string" ? req.body.model.trim() : current.model;
  const baseUrl = typeof req.body?.baseUrl === "string" ? req.body.baseUrl.trim() : current.baseUrl;
  const tokenInput = typeof req.body?.authToken === "string" ? req.body.authToken.trim() : "";
  const mcpEnabled = typeof req.body?.mcpEnabled === "boolean" ? req.body.mcpEnabled : current.mcpEnabled;
  const speedModeEnabled =
    typeof req.body?.speedModeEnabled === "boolean" ? req.body.speedModeEnabled : current.speedModeEnabled;
  const toolGateEnabled =
    typeof req.body?.toolGateEnabled === "boolean" ? req.body.toolGateEnabled : current.toolGateEnabled;
  const debugEnabled = typeof req.body?.debugEnabled === "boolean" ? req.body.debugEnabled : current.debugEnabled;
  const debugSseEnabled =
    typeof req.body?.debugSseEnabled === "boolean" ? req.body.debugSseEnabled : current.debugSseEnabled;
  const keepExistingToken = req.body?.keepExistingToken !== false;

  const next: RuntimeSettings = {
    model: model || current.model,
    baseUrl: baseUrl || current.baseUrl,
    authToken: tokenInput ? tokenInput : keepExistingToken ? current.authToken : "",
    mcpEnabled,
    speedModeEnabled,
    toolGateEnabled,
    debugEnabled,
    debugSseEnabled
  };

  await writeSettings(next);
  res.json({
    ok: true,
    model: next.model,
    baseUrl: next.baseUrl,
    mcpEnabled: next.mcpEnabled,
    speedModeEnabled: next.speedModeEnabled,
    toolGateEnabled: next.toolGateEnabled,
    debugEnabled: next.debugEnabled,
    debugSseEnabled: next.debugSseEnabled,
    hasToken: Boolean(next.authToken),
    tokenPreview: maskToken(next.authToken)
  });
});

app.post("/api/chat/ui", async (req, res) => {
  const traceId = randomUUID();
  const message = extractPrompt(req.body?.messages);
  const sessionId = typeof req.body?.id === "string" && req.body.id ? req.body.id : randomUUID();
  const sdkSessionId = sessionMap.get(sessionId);
  const seededSdkSessionId = sessionSeedMap.get(sessionId) || randomUUID();
  if (!sessionSeedMap.has(sessionId)) {
    sessionSeedMap.set(sessionId, seededSdkSessionId);
  }

  if (!message) {
    res.status(400).json({ error: "user message is required" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("x-vercel-ai-ui-message-stream", "v1");
  res.flushHeaders();

  const settings = await readSettings();
  const debugSseEnabled = settings.debugEnabled && settings.debugSseEnabled;
  const partId = `text-${randomUUID()}`;
  writeSseData(res, { type: "start" });
  writeSseData(res, { type: "text-start", id: partId });
  writeSseData(res, { type: "data-session", data: { sessionId } });
  writeDebugSse(res, false, debugSseEnabled, traceId, "request_started", {
    sessionId,
    hasResume: Boolean(sdkSessionId),
    seededSdkSessionId,
    speedModeEnabled: settings.speedModeEnabled,
    mcpEnabled: settings.mcpEnabled,
    toolGateEnabled: settings.toolGateEnabled
  });

  let closed = false;
  let queryInstance: ReturnType<typeof query> | null = null;
  let streamEventCount = 0;
  let deltaCount = 0;
  let doneSent = false;
  const heartbeat = setInterval(() => {
    if (!closed) {
      res.write(": heartbeat\n\n");
    }
  }, 15000);

  req.on("close", () => {
    closed = true;
    clearInterval(heartbeat);
    if (queryInstance) {
      try {
        queryInstance.close();
      } catch {
        // ignore close errors on disconnect
      }
    }
    activeQueries.delete(sessionId);
    logTrace(traceId, "client_closed", { sessionId, streamEventCount, deltaCount });
  });

  try {
    const options = buildQueryOptions(settings, sessionId, sdkSessionId, {
      includePartialMessages: true
    });
    if (!sdkSessionId) {
      options.sessionId = seededSdkSessionId;
      delete options.resume;
    }
    options.debug = settings.debugEnabled;
    options.stderr = (data) => {
      logTrace(traceId, "sdk_stderr", { chunk: data.slice(0, 2000) });
      if (!closed && debugSseEnabled) {
        writeSseData(res, {
          type: "data-debug",
          data: { traceId, phase: "sdk_stderr", chunk: data.slice(0, 1200) }
        });
      }
    };

    if (settings.toolGateEnabled) {
      options.canUseTool = async (toolName, input, hookOptions) => {
        const inputObj = (input ?? {}) as Record<string, unknown>;
        const isAskUserQuestion = toolName === "AskUserQuestion";
        const kind: PendingRequest["kind"] = isAskUserQuestion ? "ask_user_question" : "permission_request";
        const notify: PendingRequest["notify"] = (eventType, data) => {
          if (closed) return;
          writeSseData(res, { type: eventType, data });
        };
        const { requestId, decisionPromise } = createPendingRequest(
          kind,
          sessionId,
          toolName,
          inputObj,
          hookOptions?.toolUseID,
          notify,
          hookOptions?.suggestions
        );
        writeDebugSse(res, closed, debugSseEnabled, traceId, "tool_permission_requested", {
          requestId,
          toolName,
          hasSuggestions: Array.isArray(hookOptions?.suggestions) && hookOptions.suggestions.length > 0,
          toolUseID: hookOptions?.toolUseID
        });

        notify(lifecycleEventType(kind, "created"), {
          requestId,
          sessionId,
          toolName,
          kind,
          input: inputObj,
          suggestions: hookOptions?.suggestions,
          toolUseID: hookOptions?.toolUseID,
          createdAt: pendingRequests.get(requestId)?.createdAt,
          expiresAt: pendingRequests.get(requestId)?.expiresAt
        });

        return decisionPromise;
      };
    }

    queryInstance = query({ prompt: message, options });
    activeQueries.set(sessionId, queryInstance);
    writeDebugSse(res, closed, debugSseEnabled, traceId, "query_created", {
      sessionId,
      hasResume: Boolean(sdkSessionId)
    });

    if (settings.debugEnabled) {
      const [initProbe, accountProbe, mcpProbe, modelProbe] = await Promise.allSettled([
        withTimeout(queryInstance.initializationResult(), 5000, "initializationResult"),
        withTimeout(queryInstance.accountInfo(), 3000, "accountInfo"),
        withTimeout(queryInstance.mcpServerStatus(), 3000, "mcpServerStatus"),
        withTimeout(queryInstance.supportedModels(), 3000, "supportedModels")
      ]);

      if (initProbe.status === "fulfilled") {
        writeDebugSse(res, closed, debugSseEnabled, traceId, "probe_initialization", {
          hasCommands: Array.isArray(initProbe.value.commands),
          hasModels: Array.isArray(initProbe.value.models)
        });
      } else {
        writeDebugSse(res, closed, debugSseEnabled, traceId, "probe_initialization_error", {
          error: initProbe.reason instanceof Error ? initProbe.reason.message : String(initProbe.reason)
        });
      }

      if (accountProbe.status === "fulfilled") {
        writeDebugSse(res, closed, debugSseEnabled, traceId, "probe_account", {
          email: accountProbe.value.email || "",
          organization: accountProbe.value.organization || ""
        });
      } else {
        writeDebugSse(res, closed, debugSseEnabled, traceId, "probe_account_error", {
          error: accountProbe.reason instanceof Error ? accountProbe.reason.message : String(accountProbe.reason)
        });
      }

      if (mcpProbe.status === "fulfilled") {
        writeDebugSse(res, closed, debugSseEnabled, traceId, "probe_mcp_status", {
          count: mcpProbe.value.length
        });
      } else {
        writeDebugSse(res, closed, debugSseEnabled, traceId, "probe_mcp_status_error", {
          error: mcpProbe.reason instanceof Error ? mcpProbe.reason.message : String(mcpProbe.reason)
        });
      }

      if (modelProbe.status === "fulfilled") {
        writeDebugSse(res, closed, debugSseEnabled, traceId, "probe_supported_models", {
          count: modelProbe.value.length
        });
      } else {
        writeDebugSse(res, closed, debugSseEnabled, traceId, "probe_supported_models_error", {
          error: modelProbe.reason instanceof Error ? modelProbe.reason.message : String(modelProbe.reason)
        });
      }
    }

    if (!settings.speedModeEnabled) {
      await applyMcpToggle(queryInstance, settings.mcpEnabled);
      writeDebugSse(res, closed, debugSseEnabled, traceId, "mcp_toggled", { enabled: settings.mcpEnabled });
    }

    for await (const event of queryInstance) {
      if (closed) break;
      streamEventCount += 1;

      if (typeof event.session_id === "string") {
        sessionMap.set(sessionId, event.session_id);
        sessionSeedMap.delete(sessionId);
      }

      const deltaText = extractDeltaText(event);
      if (deltaText) {
        deltaCount += 1;
        writeSseData(res, { type: "text-delta", id: partId, delta: deltaText });
      }

      if (settings.debugEnabled && debugSseEnabled && streamEventCount <= 30) {
        writeSseData(res, {
          type: "data-debug",
          data: {
            traceId,
            phase: "sdk_event",
            eventType: event.type,
            hasSession: typeof event.session_id === "string"
          }
        });
      }
    }

    if (!closed) {
      logTrace(traceId, "stream_completed", {
        sessionId,
        streamEventCount,
        deltaCount
      });
      writeSseData(res, { type: "text-end", id: partId });
      writeSseData(res, { type: "finish" });
      writeSseDone(res);
      doneSent = true;
      clearInterval(heartbeat);
      res.end();
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    logTrace(traceId, "stream_error", { sessionId, error: msg, streamEventCount, deltaCount });
    if (!closed) {
      writeSseData(res, { type: "error", error: msg });
      writeSseData(res, { type: "finish" });
      writeSseDone(res);
      doneSent = true;
      clearInterval(heartbeat);
      res.end();
    }
  } finally {
    activeQueries.delete(sessionId);
    logTrace(traceId, "request_finished", {
      sessionId,
      closed,
      doneSent,
      streamEventCount,
      deltaCount
    });
  }
});

app.post("/api/chat/stop", async (req, res) => {
  const sessionId = typeof req.body?.id === "string" ? req.body.id : "";
  if (!sessionId) {
    res.status(400).json({ error: "id is required" });
    return;
  }

  const queryInstance = activeQueries.get(sessionId);
  if (!queryInstance) {
    res.json({ ok: true, id: sessionId, stopped: false, reason: "no_active_query" });
    return;
  }

  try {
    await queryInstance.interrupt();
  } catch {
    // ignore interrupt errors and proceed to close
  }

  try {
    queryInstance.close();
  } catch {
    // ignore close errors
  }
  activeQueries.delete(sessionId);
  res.json({ ok: true, id: sessionId, stopped: true });
});

app.post("/api/input", (req, res) => {
  const requestId = typeof req.body?.requestId === "string" ? req.body.requestId : "";
  const behavior = req.body?.behavior === "deny" ? "deny" : "allow";
  const message = typeof req.body?.message === "string" ? req.body.message : "User denied from web UI.";
  const updatedInput = req.body?.updatedInput;
  const alwaysAllow = req.body?.alwaysAllow === true;

  if (!requestId) {
    res.status(400).json({ error: "requestId is required" });
    return;
  }

  const pending = pendingRequests.get(requestId);
  if (!pending) {
    const resolved = resolvedRequests.get(requestId);
    if (resolved) {
      res.json({ ok: true, requestId, status: resolved.status, idempotent: true });
      return;
    }
    res.status(404).json({ error: "request not found" });
    return;
  }

  if (updatedInput !== undefined && (!updatedInput || typeof updatedInput !== "object")) {
    res.status(400).json({ error: "updatedInput must be an object when provided" });
    return;
  }
  if (
    pending.kind === "ask_user_question" &&
    updatedInput &&
    "answers" in (updatedInput as Record<string, unknown>) &&
    (typeof (updatedInput as Record<string, unknown>).answers !== "object" ||
      (updatedInput as Record<string, unknown>).answers === null ||
      Array.isArray((updatedInput as Record<string, unknown>).answers))
  ) {
    res.status(400).json({ error: "updatedInput.answers must be an object" });
    return;
  }

  clearTimeout(pending.timeout);
  pendingRequests.delete(requestId);

  if (behavior === "deny") {
    pending.status = "deny";
    upsertResolvedRequest({
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
    pending.resolve({
      behavior: "deny",
      message
    });
  } else {
    pending.status = "allow";
    upsertResolvedRequest({
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

  res.json({ ok: true, requestId, status: pending.status });
});

app.post("/api/input/cancel", (req, res) => {
  const requestId = typeof req.body?.requestId === "string" ? req.body.requestId : "";
  const message = typeof req.body?.message === "string" ? req.body.message : "Canceled by user from web UI.";
  if (!requestId) {
    res.status(400).json({ error: "requestId is required" });
    return;
  }

  const pending = pendingRequests.get(requestId);
  if (!pending) {
    const resolved = resolvedRequests.get(requestId);
    if (resolved) {
      res.json({ ok: true, requestId, status: resolved.status, idempotent: true });
      return;
    }
    res.status(404).json({ error: "request not found" });
    return;
  }

  clearTimeout(pending.timeout);
  pending.status = "canceled";
  pendingRequests.delete(requestId);
  upsertResolvedRequest({
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
  pending.resolve({
    behavior: "deny",
    message
  });

  res.json({ ok: true, requestId, status: "canceled" });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(port, host, () => {
  console.log(`Agent web server running at http://${host}:${port}`);
});
