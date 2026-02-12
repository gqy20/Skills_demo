import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { query } from "@anthropic-ai/claude-agent-sdk";
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
};

function normalizeEvent(event: unknown): NormalizedEvent {
  const raw = event as Record<string, unknown>;
  const type = typeof raw.type === "string" ? raw.type : "event";
  const text = extractText(event).join("\n").trim();
  return { type, text };
}

function writeNdjson(res: Response, payload: unknown): void {
  res.write(`${JSON.stringify(payload)}\n`);
}

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

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/chat", async (req, res) => {
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";

  if (!message) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  const events: NormalizedEvent[] = [];

  try {
    for await (const event of query({
      prompt: message,
      options: {
        cwd: process.cwd(),
        settingSources: ["project"]
      }
    })) {
      events.push(normalizeEvent(event));
    }

    const reply = events
      .filter((event) => event.type.includes("assistant") || event.type.includes("result") || event.type.includes("message"))
      .map((event) => event.text)
      .filter(Boolean)
      .join("\n\n")
      .trim();

    res.json({
      reply,
      events
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({
      error: message
    });
  }
});

app.post("/api/chat/stream", async (req, res) => {
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
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
    for await (const event of query({
      prompt: message,
      options: {
        cwd: process.cwd(),
        settingSources: ["project"]
      }
    })) {
      if (closed) break;
      writeNdjson(res, normalizeEvent(event));
    }

    if (!closed) {
      writeNdjson(res, { type: "done", text: "" });
      res.end();
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    if (!closed) {
      writeNdjson(res, { type: "error", text: errorMessage });
      res.end();
    }
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(port, host, () => {
  // Keep output concise for local dev.
  console.log(`Agent web server running at http://${host}:${port}`);
});
