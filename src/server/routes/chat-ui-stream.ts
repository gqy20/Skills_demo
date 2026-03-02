import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Response } from "express";
import { extractDeltaText, extractResultText, extractSdkLifecycle, writeSseData } from "../services/chat.js";
import { type MutableTurnTrace, normalizeToolLabel, writeDebugSse } from "./chat-shared.js";

type ConsumeQueryEventsParams = {
  eventStream: AsyncIterable<SDKMessage>;
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
  stopOnResult?: boolean;
  onSdkInit?: (data: { cwd: string; slashCommands: string[]; skills: string[] }) => void;
  onRuntimePhase?: (next: { phase: string; detail?: string; etaSeconds?: number | null }) => void;
  onRuntimeActivity?: (next: { detail: string }) => void;
  onRuntimeHeartbeat?: () => void;
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

function writeHookStage(
  res: Response,
  data: {
    stage: string;
    at: number;
    hookName?: string;
    hookEvent?: string;
    hookId?: string;
    toolName?: string;
    toolUseId?: string;
    outcome?: string;
    detail?: string;
    resultSubtype?: string;
    isError?: boolean;
    stopReason?: string | null;
  }
): void {
  writeSseData(res, { type: "data-hook-stage", data });
}

function writeRuntimePhase(
  res: Response,
  data: { phase: string; detail?: string; etaSeconds?: number | null; at?: number }
): void {
  writeSseData(res, {
    type: "data-runtime-phase",
    data: {
      phase: String(data.phase || "queued"),
      detail: String(data.detail || ""),
      etaSeconds: typeof data.etaSeconds === "number" ? Math.max(0, Math.floor(data.etaSeconds)) : null,
      at: Number(data.at || Date.now())
    }
  });
}

function writeRuntimeActivity(res: Response, detail: string): void {
  const text = String(detail || "").trim();
  if (!text) return;
  writeSseData(res, {
    type: "data-runtime-activity",
    data: {
      detail: text,
      at: Date.now()
    }
  });
}

export async function consumeQueryEvents({
  eventStream,
  key,
  partId,
  traceId,
  res,
  runtime,
  debugSseEnabled,
  settingsDebugEnabled,
  sessionMap,
  sessionSeedMap,
  turnTrace,
  stopOnResult = false,
  onSdkInit,
  onRuntimePhase,
  onRuntimeActivity,
  onRuntimeHeartbeat
}: ConsumeQueryEventsParams): Promise<ConsumeQueryEventsResult> {
  let streamEventCount = 0;
  let deltaCount = 0;
  let assistantText = "";
  let responsePhaseMarked = false;
  const streamStartedAt = Date.now();
  let firstTextTimeoutNotified = false;
  writeRuntimePhase(res, { phase: "planning", detail: "正在初始化代理与上下文", etaSeconds: 6, at: streamStartedAt });
  onRuntimePhase?.({ phase: "planning", detail: "正在初始化代理与上下文", etaSeconds: 6 });

  for await (const event of eventStream) {
    if (runtime.closed) break;
    onRuntimeHeartbeat?.();
    streamEventCount += 1;

    if (typeof event.session_id === "string") {
      sessionMap.set(key, event.session_id);
      sessionSeedMap.delete(key);
    }

    if (event.type === "system" && event.subtype === "init") {
      const tools = Array.isArray(event.tools)
        ? event.tools.filter((tool: unknown): tool is string => typeof tool === "string")
        : [];
      const slashCommands = Array.isArray(event.slash_commands)
        ? event.slash_commands.filter((item: unknown): item is string => typeof item === "string")
        : [];
      const skills = Array.isArray(event.skills)
        ? event.skills.filter((item: unknown): item is string => typeof item === "string")
        : [];
      onSdkInit?.({
        cwd: typeof event.cwd === "string" ? event.cwd : "",
        slashCommands,
        skills
      });
      writeSseData(res, {
        type: "data-sdk-init",
        data: {
          model: event.model || "",
          cwd: typeof event.cwd === "string" ? event.cwd : "",
          permissionMode: event.permissionMode || "",
          toolCount: tools.length,
          slashCommandCount: slashCommands.length,
          skillCount: skills.length,
          tools: tools.slice(0, 80),
          slashCommands: slashCommands.slice(0, 80),
          skills: skills.slice(0, 80),
          hasAskUserQuestionTool: tools.some((tool: unknown) => String(tool).trim().toLowerCase() === "askuserquestion")
        }
      });
      writeRuntimePhase(res, {
        phase: "planning",
        detail: "初始化完成，正在规划执行步骤",
        etaSeconds: 4
      });
      onRuntimePhase?.({ phase: "planning", detail: "初始化完成，正在规划执行步骤", etaSeconds: 4 });
      writeRuntimeActivity(res, "已完成 SDK 初始化，准备执行任务");
      onRuntimeActivity?.({ detail: "已完成 SDK 初始化，准备执行任务" });
      writeHookStage(res, {
        stage: "sdk_init",
        at: Date.now(),
        detail: `tools=${tools.length},slash=${slashCommands.length},skills=${skills.length}`
      });
    }

    const deltaText = extractDeltaText(event);
    if (deltaText) {
      deltaCount += 1;
      assistantText += deltaText;
      if (!responsePhaseMarked) {
        responsePhaseMarked = true;
        writeRuntimePhase(res, { phase: "streaming_text", detail: "正在生成可见回复", etaSeconds: 2 });
        onRuntimePhase?.({ phase: "streaming_text", detail: "正在生成可见回复", etaSeconds: 2 });
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
        writeRuntimePhase(res, { phase: "streaming_text", detail: "正在生成可见回复", etaSeconds: 2 });
        onRuntimePhase?.({ phase: "streaming_text", detail: "正在生成可见回复", etaSeconds: 2 });
        turnTrace.phases.push({ phase: "responding", at: Date.now() });
        trimPhases(turnTrace);
      }
      writeSseData(res, { type: "text-delta", id: partId, delta: resultText });
    }

    const lifecycle = extractSdkLifecycle(event);
    if (lifecycle) {
      if (lifecycle.category === "hook_started") {
        if (String(lifecycle.hookEvent || "") === "SubagentStart") {
          writeSseData(res, {
            type: "data-agent-activity",
            data: {
              status: "start",
              agentId: String(lifecycle.agentId || ""),
              agentType: String(lifecycle.agentType || ""),
              hookName: String(lifecycle.hookName || ""),
              at: Date.now()
            }
          });
          writeRuntimePhase(res, {
            phase: "running_tool",
            detail: `子代理执行中：${String(lifecycle.agentType || lifecycle.agentId || "agent")}`,
            etaSeconds: 20
          });
          onRuntimePhase?.({
            phase: "running_tool",
            detail: `子代理执行中：${String(lifecycle.agentType || lifecycle.agentId || "agent")}`,
            etaSeconds: 20
          });
        }
        writeRuntimeActivity(res, `触发 Hook：${String(lifecycle.hookName || lifecycle.hookEvent || "unknown")}`);
        onRuntimeActivity?.({ detail: `触发 Hook：${String(lifecycle.hookName || lifecycle.hookEvent || "unknown")}` });
        writeHookStage(res, {
          stage: "hook_started",
          at: Date.now(),
          hookId: String(lifecycle.hookId || ""),
          hookName: String(lifecycle.hookName || ""),
          hookEvent: String(lifecycle.hookEvent || "")
        });
      }

      if (lifecycle.category === "hook_progress") {
        writeHookStage(res, {
          stage: "hook_progress",
          at: Date.now(),
          hookId: String(lifecycle.hookId || ""),
          hookName: String(lifecycle.hookName || ""),
          hookEvent: String(lifecycle.hookEvent || ""),
          detail: String(lifecycle.output || lifecycle.stderr || "")
        });
      }

      if (lifecycle.category === "hook_response") {
        if (String(lifecycle.hookEvent || "") === "SubagentStop") {
          writeSseData(res, {
            type: "data-agent-activity",
            data: {
              status: "stop",
              agentId: String(lifecycle.agentId || ""),
              agentType: String(lifecycle.agentType || ""),
              hookName: String(lifecycle.hookName || ""),
              at: Date.now()
            }
          });
        }
        writeHookStage(res, {
          stage: "hook_response",
          at: Date.now(),
          hookId: String(lifecycle.hookId || ""),
          hookName: String(lifecycle.hookName || ""),
          hookEvent: String(lifecycle.hookEvent || ""),
          outcome: String(lifecycle.outcome || ""),
          detail: lifecycle.exitCode === null ? "" : `exit=${String(lifecycle.exitCode)}`
        });
      }

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
        writeRuntimePhase(res, {
          phase: "running_tool",
          detail: `正在调用 ${String(lifecycle.toolName || "tool")}`,
          etaSeconds: 20
        });
        onRuntimePhase?.({
          phase: "running_tool",
          detail: `正在调用 ${String(lifecycle.toolName || "tool")}`,
          etaSeconds: 20
        });
        writeRuntimeActivity(res, `工具执行中：${String(lifecycle.toolName || "unknown_tool")}`);
        onRuntimeActivity?.({ detail: `工具执行中：${String(lifecycle.toolName || "unknown_tool")}` });
        writeSseData(res, {
          type: "data-tool-progress",
          data: {
            toolName: lifecycle.toolName || "",
            toolUseId: lifecycle.toolUseId || "",
            elapsedSeconds: lifecycle.elapsedSeconds ?? null
          }
        });
        writeHookStage(res, {
          stage: "tool_progress",
          at: Date.now(),
          toolName: String(lifecycle.toolName || ""),
          toolUseId: String(lifecycle.toolUseId || "")
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
        writeRuntimePhase(res, {
          phase: "synthesizing",
          detail: "工具返回结果，正在汇总与校验",
          etaSeconds: 8
        });
        onRuntimePhase?.({ phase: "synthesizing", detail: "工具返回结果，正在汇总与校验", etaSeconds: 8 });
        writeRuntimeActivity(res, "工具执行完成，开始汇总阶段");
        onRuntimeActivity?.({ detail: "工具执行完成，开始汇总阶段" });
        writeSseData(res, {
          type: "data-tool-use-summary",
          data: { summary: lifecycle.summary || "" }
        });
        writeHookStage(res, {
          stage: "tool_summary",
          at: Date.now(),
          detail: summary
        });
      }

      if (lifecycle.category === "result") {
        const donePhase = lifecycle.isError === true ? "failed" : "completed";
        const doneDetail = lifecycle.isError === true ? "请求执行失败，请重试" : "执行完成";
        writeRuntimePhase(res, { phase: donePhase, detail: doneDetail, etaSeconds: 0 });
        onRuntimePhase?.({ phase: donePhase, detail: doneDetail, etaSeconds: 0 });
        writeHookStage(res, {
          stage: "result",
          at: Date.now(),
          resultSubtype: String(lifecycle.subtype || ""),
          isError: lifecycle.isError === true,
          stopReason: lifecycle.stopReason ? String(lifecycle.stopReason) : null
        });
      }

      writeDebugSse(res, runtime.closed, debugSseEnabled, traceId, "sdk_lifecycle", lifecycle);
    }

    if (!responsePhaseMarked && !firstTextTimeoutNotified && Date.now() - streamStartedAt >= 20000) {
      firstTextTimeoutNotified = true;
      writeSseData(res, {
        type: "data-runtime-warning",
        data: {
          code: "no_text_delta",
          detail: "等待工具/上游返回",
          waitedSeconds: Math.floor((Date.now() - streamStartedAt) / 1000),
          suggestion: ""
        }
      });
      writeSseData(res, {
        type: "data-first-token-timeout",
        data: {
          waitedSeconds: Math.floor((Date.now() - streamStartedAt) / 1000),
          streamEventCount
        }
      });
      writeHookStage(res, {
        stage: "first_text_timeout",
        at: Date.now(),
        detail: "no_text_delta"
      });
      writeDebugSse(res, runtime.closed, debugSseEnabled, traceId, "first_text_timeout", {
        waitedSeconds: Math.floor((Date.now() - streamStartedAt) / 1000),
        streamEventCount
      });
    }

    if (event.type === "result" && event.is_error) {
      const maybeErrors = "errors" in event ? event.errors : undefined;
      const firstError = Array.isArray(maybeErrors) && maybeErrors.length > 0 ? String(maybeErrors[0]) : "";
      const message = firstError || `SDK result error: ${event.subtype}`;
      writeSseData(res, { type: "error", error: message });
    }

    if (stopOnResult && event.type === "result") {
      break;
    }

    if (settingsDebugEnabled && debugSseEnabled && streamEventCount <= 60) {
      const streamSubtype =
        event.type === "stream_event" && event.event && typeof event.event === "object"
          ? String((event.event as Record<string, unknown>).type || "")
          : "";
      const deltaType =
        event.type === "stream_event" &&
        event.event &&
        typeof event.event === "object" &&
        (event.event as Record<string, unknown>).delta &&
        typeof (event.event as Record<string, unknown>).delta === "object"
          ? String((((event.event as Record<string, unknown>).delta as Record<string, unknown>).type || ""))
          : "";
      writeSseData(res, {
        type: "data-debug",
        data: {
          traceId,
          phase: "sdk_event",
          eventType: event.type,
          streamSubtype,
          deltaType,
          hasSession: typeof event.session_id === "string"
        }
      });
    }
  }

  return { assistantText, streamEventCount, deltaCount };
}
