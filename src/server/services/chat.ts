import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Response } from "express";

type ChatMessage = {
  role?: string;
  content?: unknown;
  parts?: Array<{ type?: string; text?: string }>;
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
    if (typeof v.text === "string") texts.push(...extractText(v.text));
    if (v.content !== undefined) texts.push(...extractText(v.content));
    if (v.message !== undefined) texts.push(...extractText(v.message));
    if (v.result !== undefined) texts.push(...extractText(v.result));
    return texts;
  }
  return [];
}

export function extractPrompt(messages: unknown): string {
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

export function extractDeltaText(event: SDKMessage): string {
  if (event.type !== "stream_event") return "";
  const raw = event.event as Record<string, unknown>;
  if (raw.type !== "content_block_delta") return "";
  const delta = raw.delta as Record<string, unknown> | undefined;
  if (!delta || delta.type !== "text_delta") return "";
  return typeof delta.text === "string" ? delta.text : "";
}

export function extractResultText(event: SDKMessage): string {
  if (event.type !== "result") return "";
  if (event.subtype !== "success") return "";
  return typeof event.result === "string" ? event.result : "";
}

export function extractSdkLifecycle(event: SDKMessage): Record<string, unknown> | null {
  if (event.type === "system") {
    return {
      category: "system",
      subtype: event.subtype || "unknown"
    };
  }

  if (event.type === "tool_progress") {
    return {
      category: "tool_progress",
      toolName: event.tool_name,
      toolUseId: event.tool_use_id,
      elapsedSeconds: event.elapsed_time_seconds
    };
  }

  if (event.type === "tool_use_summary") {
    return {
      category: "tool_use_summary",
      summary: event.summary
    };
  }

  if (event.type === "result") {
    return {
      category: "result",
      subtype: event.subtype,
      isError: event.is_error,
      stopReason: event.stop_reason || null
    };
  }

  return null;
}

export function writeSseData(res: Response, data: unknown): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export function writeSseDone(res: Response): void {
  res.write("data: [DONE]\n\n");
}
