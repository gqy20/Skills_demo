import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { query, type SDKMessage, type PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type { Response } from "express";

const app = express();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(__dirname));

type NormalizedEvent = {
  type: string;
  text: string;
  sessionId?: string;
};

type PendingRequest = {
  sessionId: string;
  toolName: string;
  input: Record<string, unknown>;
  suggestions?: unknown[];
  resolve: (decision: PermissionResult) => void;
  timeout: NodeJS.Timeout;
};

const pendingRequests = new Map<string, PendingRequest>();
const sessionMap = new Map<string, string>();

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

function normalizeSdkEvent(event: SDKMessage): NormalizedEvent {
  const type = typeof event.type === "string" ? event.type : "event";
  const text = extractText(event).join("\n").trim();
  const sessionId = typeof event.session_id === "string" ? event.session_id : undefined;
  return { type, text, sessionId };
}

function collectReply(events: NormalizedEvent[]): string {
  return events
    .filter((event) => event.type.includes("assistant") || event.type.includes("result") || event.type.includes("message"))
    .map((event) => event.text)
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function writeSse(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function createPendingRequest(
  sessionId: string,
  toolName: string,
  input: Record<string, unknown>,
  suggestions?: unknown[],
  timeoutMs = 5 * 60 * 1000
): { requestId: string; decisionPromise: Promise<PermissionResult> } {
  const requestId = randomUUID();

  const decisionPromise = new Promise<PermissionResult>((resolve) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId);
      resolve({
        behavior: "deny",
        message: "Timed out waiting for user input."
      });
    }, timeoutMs);

    pendingRequests.set(requestId, {
      sessionId,
      toolName,
      input,
      suggestions,
      resolve,
      timeout
    });
  });

  return { requestId, decisionPromise };
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, transport: "query-sse", askQuestion: true });
});

app.post("/api/chat", async (req, res) => {
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  const sessionId = typeof req.body?.sessionId === "string" && req.body.sessionId ? req.body.sessionId : randomUUID();
  const sdkSessionId = sessionMap.get(sessionId);

  if (!message) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  try {
    const events: NormalizedEvent[] = [];
    for await (const event of query({
      prompt: message,
      options: {
        cwd: process.cwd(),
        settingSources: ["project"],
        ...(sdkSessionId ? { resume: sdkSessionId } : { sessionId })
      }
    })) {
      const normalized = normalizeSdkEvent(event);
      events.push(normalized);
      if (normalized.sessionId) {
        sessionMap.set(sessionId, normalized.sessionId);
      }
    }

    res.json({
      sessionId,
      reply: collectReply(events),
      events
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: msg });
  }
});

app.post("/api/chat/sse", async (req, res) => {
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  const sessionId = typeof req.body?.sessionId === "string" && req.body.sessionId ? req.body.sessionId : randomUUID();
  const sdkSessionId = sessionMap.get(sessionId);

  if (!message) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  writeSse(res, "session", { sessionId });

  let closed = false;
  req.on("close", () => {
    closed = true;
  });

  try {
    for await (const event of query({
      prompt: message,
      options: {
        cwd: process.cwd(),
        settingSources: ["project"],
        ...(sdkSessionId ? { resume: sdkSessionId } : { sessionId }),
        canUseTool: async (toolName, input, options) => {
          const inputObj = (input ?? {}) as Record<string, unknown>;
          const { requestId, decisionPromise } = createPendingRequest(sessionId, toolName, inputObj, options?.suggestions);

          if (!closed) {
            writeSse(res, toolName === "AskUserQuestion" ? "ask_user_question" : "permission_request", {
              requestId,
              sessionId,
              toolName,
              input: inputObj,
              suggestions: options?.suggestions,
              toolUseID: options?.toolUseID
            });
          }

          return decisionPromise;
        }
      }
    })) {
      if (closed) break;
      const normalized = normalizeSdkEvent(event);
      if (normalized.sessionId) {
        sessionMap.set(sessionId, normalized.sessionId);
      }
      writeSse(res, "message", normalized);
    }

    if (!closed) {
      writeSse(res, "done", { sessionId });
      res.end();
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    if (!closed) {
      writeSse(res, "error", { sessionId, error: msg });
      res.end();
    }
  }
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
    res.status(404).json({ error: "request not found or already resolved" });
    return;
  }

  clearTimeout(pending.timeout);
  pendingRequests.delete(requestId);

  if (behavior === "deny") {
    pending.resolve({
      behavior: "deny",
      message
    });
  } else {
    pending.resolve({
      behavior: "allow",
      updatedInput:
        updatedInput && typeof updatedInput === "object"
          ? (updatedInput as Record<string, unknown>)
          : pending.input,
      updatedPermissions: alwaysAllow && Array.isArray(pending.suggestions) ? (pending.suggestions as never[]) : undefined
    });
  }

  res.json({ ok: true });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(port, host, () => {
  console.log(`Agent web server running at http://${host}:${port}`);
});
