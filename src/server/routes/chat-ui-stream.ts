import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Response } from "express";
import { extractDeltaText, extractResultText, extractSdkLifecycle, writeSseData } from "../services/chat.js";
import { type MutableTurnTrace, normalizeToolLabel, writeDebugSse } from "./chat-shared.js";

type ConsumeQueryEventsParams = {
  queryInstance: ReturnType<typeof query>;
  key: string;
  partId: string;
  traceId: string;
  res: Response;
  runtime: { closed: boolean };
  debugSseEnabled: boolean;
  settingsDebugEnabled: boolean;
  sessionMap: Map<string, string>;
  sessionSeedMap: Map<string, string>;
  turnTrace: MutableTurnTrace;
};

type ConsumeQueryEventsResult = {
  assistantText: string;
  streamEventCount: number;
  deltaCount: number;
};

function trimPhases(turnTrace: MutableTurnTrace): void {
  if (turnTrace.phases.length > 30) {
    turnTrace.phases = turnTrace.phases.slice(-30);
  }
}

export async function consumeQueryEvents({
  queryInstance,
  key,
  partId,
  traceId,
  res,
  runtime,
  debugSseEnabled,
  settingsDebugEnabled,
  sessionMap,
  sessionSeedMap,
  turnTrace
}: ConsumeQueryEventsParams): Promise<ConsumeQueryEventsResult> {
  let streamEventCount = 0;
  let deltaCount = 0;
  let assistantText = "";
  let responsePhaseMarked = false;

  for await (const event of queryInstance) {
    if (runtime.closed) break;
    streamEventCount += 1;

    if (typeof event.session_id === "string") {
      sessionMap.set(key, event.session_id);
      sessionSeedMap.delete(key);
    }

    if (event.type === "system" && event.subtype === "init") {
      const tools = Array.isArray(event.tools)
        ? event.tools.filter((tool: unknown): tool is string => typeof tool === "string")
        : [];
      writeSseData(res, {
        type: "data-sdk-init",
        data: {
          model: event.model || "",
          permissionMode: event.permissionMode || "",
          toolCount: tools.length,
          tools: tools.slice(0, 80),
          hasAskUserQuestionTool: tools.some((tool: unknown) => String(tool).trim().toLowerCase() === "askuserquestion")
        }
      });
    }

    const deltaText = extractDeltaText(event);
    if (deltaText) {
      deltaCount += 1;
      assistantText += deltaText;
      if (!responsePhaseMarked) {
        responsePhaseMarked = true;
        turnTrace.phases.push({ phase: "responding", at: Date.now() });
        trimPhases(turnTrace);
      }
      writeSseData(res, { type: "text-delta", id: partId, delta: deltaText });
    }

    const resultText = extractResultText(event);
    if (resultText && deltaCount === 0) {
      deltaCount += 1;
      assistantText += resultText;
      if (!responsePhaseMarked) {
        responsePhaseMarked = true;
        turnTrace.phases.push({ phase: "responding", at: Date.now() });
        trimPhases(turnTrace);
      }
      writeSseData(res, { type: "text-delta", id: partId, delta: resultText });
    }

    const lifecycle = extractSdkLifecycle(event);
    if (lifecycle) {
      if (lifecycle.category === "tool_progress") {
        const label = normalizeToolLabel(lifecycle.toolName || "");
        const useId = String(lifecycle.toolUseId || "");
        const old = turnTrace.tools[label] || { count: 0, elapsedSeconds: 0 };
        const isNewUse = useId ? !turnTrace._seenUseIds.has(useId) : old.count === 0;
        if (useId) turnTrace._seenUseIds.add(useId);
        turnTrace.tools[label] = {
          count: isNewUse ? old.count + 1 : old.count,
          elapsedSeconds: Math.max(old.elapsedSeconds || 0, Number(lifecycle.elapsedSeconds || 0))
        };
        if (turnTrace._lastToolLabel !== label) {
          turnTrace._lastToolLabel = label;
          turnTrace.phases.push({ phase: "tool_running", at: Date.now(), detail: label });
          trimPhases(turnTrace);
        }
        writeSseData(res, {
          type: "data-tool-progress",
          data: {
            toolName: lifecycle.toolName || "",
            toolUseId: lifecycle.toolUseId || "",
            elapsedSeconds: lifecycle.elapsedSeconds ?? null
          }
        });
      }

      if (lifecycle.category === "tool_use_summary") {
        const summary = String(lifecycle.summary || "");
        const matched = summary.match(/\/([a-zA-Z0-9_-]+)/g) || [];
        for (const token of matched) {
          const name = token.replace("/", "").trim().toLowerCase();
          if (!name) continue;
          const old = turnTrace.skills[name] || { count: 0 };
          turnTrace.skills[name] = { count: old.count + 1 };
        }
        if (summary) {
          turnTrace.actions.push(summary.length > 220 ? `${summary.slice(0, 220)}...` : summary);
          if (turnTrace.actions.length > 8) turnTrace.actions = turnTrace.actions.slice(-8);
        }
        turnTrace.phases.push({ phase: "tool_summary", at: Date.now() });
        trimPhases(turnTrace);
        writeSseData(res, {
          type: "data-tool-use-summary",
          data: { summary: lifecycle.summary || "" }
        });
      }

      writeDebugSse(res, runtime.closed, debugSseEnabled, traceId, "sdk_lifecycle", lifecycle);
    }

    if (event.type === "result" && event.is_error) {
      const maybeErrors = "errors" in event ? event.errors : undefined;
      const firstError = Array.isArray(maybeErrors) && maybeErrors.length > 0 ? String(maybeErrors[0]) : "";
      const message = firstError || `SDK result error: ${event.subtype}`;
      writeSseData(res, { type: "error", error: message });
    }

    if (settingsDebugEnabled && debugSseEnabled && streamEventCount <= 30) {
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

  return { assistantText, streamEventCount, deltaCount };
}
