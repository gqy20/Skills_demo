import { promises as fs } from "node:fs";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Response } from "express";
import { listWorkspaceFiles, loadIgnoreRules, normalizeRelativePath, resolveWorkspacePath } from "./files.js";

type ChatMessage = {
  role?: string;
  content?: unknown;
  parts?: Array<{ type?: string; text?: string }>;
};

type SlashDirective = {
  raw: string;
  name: string;
  args: string;
};

type MentionContext = {
  token: string;
  path: string;
  type: "file" | "directory";
  summary: string;
  content?: string;
};

export type PromptDirectives = {
  slash: SlashDirective | null;
  mentionTokens: string[];
};

export type EnhancedPromptResult = {
  prompt: string;
  directives: PromptDirectives;
  unknownSlash: string | null;
  mentionResolved: string[];
  mentionMissing: string[];
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

function extractMessageText(msg: ChatMessage): string {
  const partTexts = Array.isArray(msg.parts) ? msg.parts.filter((p) => p?.type === "text").map((p) => p.text || "") : [];
  const fromParts = extractText(partTexts).join("\n").trim();
  if (fromParts) return fromParts;
  return extractText(msg.content).join("\n").trim();
}

export function buildRestartRecoveryPrompt(
  messages: unknown,
  latestUserText: string,
  options: { maxMessages?: number; maxChars?: number } = {}
): string {
  return buildRestartRecoveryPayload(messages, latestUserText, options).prompt;
}

export type RestartRecoveryPayload = {
  prompt: string;
  replayedMessageCount: number;
};

export function buildRestartRecoveryPayload(
  messages: unknown,
  latestUserText: string,
  options: { maxMessages?: number; maxChars?: number } = {}
): RestartRecoveryPayload {
  const latest = String(latestUserText || "").trim();
  if (!latest) return { prompt: "", replayedMessageCount: 0 };
  if (!Array.isArray(messages)) return { prompt: latest, replayedMessageCount: 0 };

  const maxMessages = Math.max(4, Math.floor(options.maxMessages ?? 24));
  const maxChars = Math.max(2000, Math.floor(options.maxChars ?? 12000));
  const list = messages as ChatMessage[];
  const normalized = list
    .map((msg) => {
      const roleRaw = String(msg?.role || "").trim().toLowerCase();
      const role = roleRaw === "assistant" ? "assistant" : roleRaw === "system" ? "system" : roleRaw === "user" ? "user" : "";
      const text = extractMessageText(msg);
      if (!role || !text) return null;
      return { role, text };
    })
    .filter((item): item is { role: "user" | "assistant" | "system"; text: string } => Boolean(item))
    .slice(-maxMessages);

  if (normalized.length <= 1) return { prompt: latest, replayedMessageCount: 0 };

  // Avoid duplicating the current user input in both transcript and current message sections.
  if (normalized[normalized.length - 1]?.role === "user" && normalized[normalized.length - 1]?.text === latest) {
    normalized.pop();
  }
  if (normalized.length === 0) return { prompt: latest, replayedMessageCount: 0 };

  const replayedMessageCount = normalized.length;
  const lines = normalized.map((item) => `${item.role}: ${item.text}`);
  let transcript = lines.join("\n\n");
  if (transcript.length > maxChars) {
    transcript = transcript.slice(transcript.length - maxChars);
  }

  return {
    prompt: [
      "[历史对话上下文（服务重启后自动回放）]",
      transcript,
      "",
      "[当前用户消息]",
      latest,
      "",
      "请基于以上历史上下文继续回答，保持与此前会话一致。"
    ].join("\n"),
    replayedMessageCount
  };
}

function trimTrailingPunctuation(token: string): string {
  return token.replace(/[)\]}>,.;:!?，。；：！？、]+$/g, "");
}

function parseSlashDirective(text: string): SlashDirective | null {
  const trimmed = text.trimStart();
  const m = trimmed.match(/^\/([a-zA-Z0-9_-]+)(?:\s+([\s\S]*))?$/);
  if (!m) return null;
  const name = (m[1] || "").trim().toLowerCase();
  if (!name) return null;
  return {
    raw: m[0] || "",
    name,
    args: (m[2] || "").trim()
  };
}

function parseMentionTokens(text: string): string[] {
  const found = new Set<string>();
  const re = /(^|\s)@([^\s@]+)/g;
  let m: RegExpExecArray | null = re.exec(text);
  while (m) {
    const raw = trimTrailingPunctuation((m[2] || "").trim());
    const normalized = normalizeRelativePath(raw);
    if (normalized) found.add(normalized);
    m = re.exec(text);
  }
  return Array.from(found).slice(0, 6);
}

async function safeReadFileSnippet(abs: string, limitBytes: number): Promise<string | null> {
  try {
    const buf = await fs.readFile(abs);
    const slice = buf.subarray(0, limitBytes);
    for (const b of slice) {
      if (b === 0) return null;
    }
    return slice.toString("utf-8").trim();
  } catch {
    return null;
  }
}

async function buildMentionContext(workspaceRoot: string, mentionTokens: string[]): Promise<{
  resolved: MentionContext[];
  missing: string[];
}> {
  if (mentionTokens.length === 0) {
    return { resolved: [], missing: [] };
  }

  const rules = await loadIgnoreRules(workspaceRoot);
  const resolved: MentionContext[] = [];
  const missing: string[] = [];

  for (const token of mentionTokens) {
    const abs = resolveWorkspacePath(workspaceRoot, token);
    if (!abs) {
      missing.push(token);
      continue;
    }

    try {
      const stat = await fs.stat(abs);
      if (stat.isDirectory()) {
        const items = await listWorkspaceFiles(workspaceRoot, token, 1, rules);
        const preview = items.slice(0, 12).map((item) => `${item.type === "directory" ? "[D]" : "[F]"} ${item.path}`);
        resolved.push({
          token,
          path: token,
          type: "directory",
          summary: `目录，含 ${items.length} 项`,
          content: preview.join("\n")
        });
        continue;
      }

      if (stat.isFile()) {
        const snippet = await safeReadFileSnippet(abs, 4000);
        const ext = token.includes(".") ? token.split(".").pop() || "" : "";
        resolved.push({
          token,
          path: token,
          type: "file",
          summary: `文件，${Math.max(0, stat.size)} bytes${ext ? `，类型 ${ext}` : ""}`,
          content: snippet || "(文件可能是二进制或不可读，未提取文本内容)"
        });
        continue;
      }

      missing.push(token);
    } catch {
      missing.push(token);
    }
  }

  return { resolved, missing };
}

export function parsePromptDirectives(prompt: string): PromptDirectives {
  const text = String(prompt || "");
  return {
    slash: parseSlashDirective(text),
    mentionTokens: parseMentionTokens(text)
  };
}

export async function enhancePromptWithDirectives(
  workspaceRoot: string,
  prompt: string,
  availableSlashNames: Set<string> | null
): Promise<EnhancedPromptResult> {
  const directives = parsePromptDirectives(prompt);
  const slashName = directives.slash?.name || "";
  const unknownSlash =
    slashName && availableSlashNames && availableSlashNames.size > 0 && !availableSlashNames.has(slashName)
      ? slashName
      : null;

  const mentionResult = await buildMentionContext(workspaceRoot, directives.mentionTokens);
  if (mentionResult.resolved.length === 0 && !unknownSlash) {
    return {
      prompt,
      directives,
      unknownSlash: null,
      mentionResolved: [],
      mentionMissing: mentionResult.missing
    };
  }

  const chunks: string[] = [prompt.trim()];

  if (unknownSlash) {
    chunks.push(
      [
        "[系统提示]",
        `你输入了 /${unknownSlash}，但它不在当前可用快捷指令列表中。`,
        "请把它当作普通文本意图理解，并在回答里提醒用户可先查看 /api/skills。"
      ].join("\n")
    );
  }

  if (mentionResult.resolved.length > 0 || mentionResult.missing.length > 0) {
    const lines: string[] = ["[引用上下文]"];
    for (const item of mentionResult.resolved) {
      lines.push(`- @${item.token} -> ${item.type} (${item.summary})`);
      if (item.content) {
        lines.push(item.type === "file" ? "```text" : "```");
        lines.push(item.content);
        lines.push("```");
      }
    }
    for (const miss of mentionResult.missing) {
      lines.push(`- @${miss} -> 未找到或不可访问`);
    }
    lines.push("请优先结合以上引用内容进行分析，并明确标注哪些结论来自引用上下文。");
    chunks.push(lines.join("\n"));
  }

  return {
    prompt: chunks.filter(Boolean).join("\n\n"),
    directives,
    unknownSlash,
    mentionResolved: mentionResult.resolved.map((item) => item.path),
    mentionMissing: mentionResult.missing
  };
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
    if (event.subtype === "hook_started") {
      return {
        category: "hook_started",
        hookId: event.hook_id,
        hookName: event.hook_name,
        hookEvent: event.hook_event
      };
    }

    if (event.subtype === "hook_progress") {
      return {
        category: "hook_progress",
        hookId: event.hook_id,
        hookName: event.hook_name,
        hookEvent: event.hook_event,
        output: event.output || "",
        stderr: event.stderr || ""
      };
    }

    if (event.subtype === "hook_response") {
      return {
        category: "hook_response",
        hookId: event.hook_id,
        hookName: event.hook_name,
        hookEvent: event.hook_event,
        outcome: event.outcome,
        exitCode: event.exit_code ?? null
      };
    }

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
