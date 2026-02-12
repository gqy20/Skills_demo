import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Response } from "express";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { AgentClientManager } from "./agent-client.js";

const app = express();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
const manager = new AgentClientManager();

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

    if (typeof v.text === "string") {
      texts.push(...extractText(v.text));
    }
    if (v.content !== undefined) {
      texts.push(...extractText(v.content));
    }
    if (v.message !== undefined) {
      texts.push(...extractText(v.message));
    }
    if (v.result !== undefined) {
      texts.push(...extractText(v.result));
    }

    return texts;
  }

  return [];
}

function normalizeSdkEvent(event: SDKMessage): NormalizedEvent {
  const type = typeof event.type === "string" ? event.type : "event";
  const text = extractText(event).join("\n").trim();
  return { type, text };
}

function writeNdjson(res: Response, payload: unknown): void {
  res.write(`${JSON.stringify(payload)}\n`);
}

function collectReply(events: NormalizedEvent[]): string {
  return events
    .filter((event) => event.type.includes("assistant") || event.type.includes("result") || event.type.includes("message"))
    .map((event) => event.text)
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, transport: "sdk-session-client" });
});

app.post("/api/session", (_req, res) => {
  const { sessionId } = manager.createSession();
  res.json({ sessionId });
});

app.delete("/api/session/:id", (req, res) => {
  const ok = manager.closeSession(req.params.id);
  if (!ok) {
    res.status(404).json({ error: "session not found" });
    return;
  }
  res.json({ ok: true });
});

app.post("/api/chat", async (req, res) => {
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  const sessionIdFromReq = typeof req.body?.sessionId === "string" ? req.body.sessionId.trim() : "";

  if (!message) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  try {
    const { sessionId, client } = manager.getOrCreate(sessionIdFromReq || undefined);
    const events: NormalizedEvent[] = [];

    await client.send(message, (event) => {
      events.push(normalizeSdkEvent(event));
    });

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

app.post("/api/chat/stream", async (req, res) => {
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  const sessionIdFromReq = typeof req.body?.sessionId === "string" ? req.body.sessionId.trim() : "";

  if (!message) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  let closed = false;
  req.on("close", () => {
    closed = true;
  });

  try {
    const { sessionId, client } = manager.getOrCreate(sessionIdFromReq || undefined);
    writeNdjson(res, { type: "session", sessionId });

    await client.send(message, (event) => {
      if (closed) return;
      writeNdjson(res, normalizeSdkEvent(event));
    });

    if (!closed) {
      writeNdjson(res, { type: "done", text: "", sessionId });
      res.end();
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    if (!closed) {
      writeNdjson(res, { type: "error", text: msg });
      res.end();
    }
  }
});

app.post("/api/input", (_req, res) => {
  res.status(410).json({
    error: "canUseTool bridge is not supported in v2 session API path; use query path if you need AskUserQuestion interception."
  });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(port, host, () => {
  console.log(`Agent web server running at http://${host}:${port}`);
});
