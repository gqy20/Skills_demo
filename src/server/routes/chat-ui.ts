import { randomUUID } from "node:crypto";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Request, Response } from "express";
import { enhancePromptWithDirectives, extractPrompt, parsePromptDirectives, writeSseData, writeSseDone } from "../services/chat.js";
import { type PendingNotify, type PendingRequestKind } from "../services/pending.js";
import { appendSessionTurn, type StoredToolTrace } from "../services/sessions.js";
import { applyMcpToggle, buildQueryOptions, withTimeout } from "../services/query.js";
import { readSettings } from "../services/settings.js";
import { fetchSkills } from "../services/skills.js";
import {
  createTurnTrace,
  isAskUserQuestionTool,
  logTrace,
  normalizeToolLabel,
  sessionKey,
  type ChatRoutesDeps,
  writeDebugSse
} from "./chat-shared.js";
import { consumeQueryEvents } from "./chat-ui-stream.js";
import { runDebugProbes, startMcpStatusProbe } from "./chat-ui-probes.js";
import {
  shouldRunDebugProbesBlocking,
  shouldRunPerTurnMcpProbe,
  shouldRunPerTurnMcpToggle
} from "./chat-ui-optimization.js";
import { resolveAvailableSlashNames } from "./chat-ui-slash-cache.js";

type RuntimeFlags = {
  closed: boolean;
  doneSent: boolean;
};

export async function handleChatUiRequest(req: Request, res: Response, deps: ChatRoutesDeps): Promise<void> {
  const { workspaceRegistry, defaultSettings, sessionMap, sessionSeedMap, pendingStore, activeQueries } = deps;
  const workspace = workspaceRegistry.requireWorkspace(req, res);
  if (!workspace) return;

  const traceId = randomUUID();
  const rawMessage = extractPrompt(req.body?.messages);
  const sessionId = typeof req.body?.id === "string" && req.body.id ? req.body.id : randomUUID();
  const key = sessionKey(workspace.id, sessionId);
  const sdkSessionId = sessionMap.get(key);
  const seededSdkSessionId = sessionSeedMap.get(key) || randomUUID();
  if (!sessionSeedMap.has(key)) {
    sessionSeedMap.set(key, seededSdkSessionId);
  }

  if (!rawMessage) {
    res.status(400).json({ error: "user message is required" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("x-vercel-ai-ui-message-stream", "v1");
  res.flushHeaders();

  const settings = await readSettings(workspace.root, defaultSettings);
  const parsedDirectives = parsePromptDirectives(rawMessage);
  let availableSlashNames: Set<string> | null = null;
  if (parsedDirectives.slash) {
    const slashResolution = await resolveAvailableSlashNames(workspace.root, settings, {
      fetchSkills: (workspaceRoot, runtimeSettings) =>
        fetchSkills(workspaceRoot, runtimeSettings, { buildQueryOptions, withTimeout })
    });
    availableSlashNames = slashResolution.names;
    if (slashResolution.source === "cache_stale_on_error" || slashResolution.source === "unavailable") {
      logTrace(traceId, "slash_names_resolution_degraded", {
        workspaceId: workspace.id,
        sessionId,
        source: slashResolution.source,
        error: slashResolution.error
      });
      writeDebugSse(res, false, settings.debugEnabled && settings.debugSseEnabled, traceId, "slash_names_resolution_degraded", {
        source: slashResolution.source,
        error: slashResolution.error
      });
    }
  }

  const enhanced = await enhancePromptWithDirectives(workspace.root, rawMessage, availableSlashNames);
  const gateEnabled = settings.permissionProfile === "standard" && settings.toolGateEnabled;
  const debugSseEnabled = settings.debugEnabled && settings.debugSseEnabled;
  const partId = `text-${randomUUID()}`;

  writeSseData(res, { type: "start" });
  writeSseData(res, { type: "text-start", id: partId });
  writeSseData(res, { type: "data-session", data: { sessionId } });
  writeSseData(res, { type: "data-tool-gate-status", data: { enabled: gateEnabled } });
  writeSseData(res, {
    type: "data-input-directives",
    data: {
      slash: enhanced.directives.slash ? `/${enhanced.directives.slash.name}` : "",
      unknownSlash: enhanced.unknownSlash || "",
      mentionCount: enhanced.directives.mentionTokens.length,
      mentionResolvedCount: enhanced.mentionResolved.length,
      mentionMissing: enhanced.mentionMissing
    }
  });

  writeDebugSse(res, false, debugSseEnabled, traceId, "request_started", {
    workspaceId: workspace.id,
    sessionId,
    hasResume: Boolean(sdkSessionId),
    seededSdkSessionId,
    speedModeEnabled: settings.speedModeEnabled,
    mcpEnabled: settings.mcpEnabled,
    toolGateEnabled: gateEnabled,
    permissionProfile: settings.permissionProfile,
    hasSlash: Boolean(enhanced.directives.slash),
    unknownSlash: enhanced.unknownSlash || "",
    mentionCount: enhanced.directives.mentionTokens.length,
    mentionResolvedCount: enhanced.mentionResolved.length
  });

  const runtime: RuntimeFlags = { closed: false, doneSent: false };
  let queryInstance: ReturnType<typeof query> | null = null;
  const turnTrace = createTurnTrace();
  const heartbeat = setInterval(() => {
    if (!runtime.closed) {
      res.write(": heartbeat\n\n");
    }
  }, 15000);

  req.on("close", () => {
    runtime.closed = true;
    clearInterval(heartbeat);
    if (queryInstance) {
      try {
        queryInstance.close();
      } catch {
        // ignore close errors on disconnect
      }
    }
    activeQueries.delete(key);
    logTrace(traceId, "client_closed", { workspaceId: workspace.id, sessionId });
  });

  let streamEventCount = 0;
  let deltaCount = 0;

  try {
    const options = buildQueryOptions(workspace.root, settings, sessionId, sdkSessionId);
    if (!sdkSessionId) {
      options.sessionId = seededSdkSessionId;
      delete options.resume;
    }
    options.debug = settings.debugEnabled;
    options.stderr = (data) => {
      logTrace(traceId, "sdk_stderr", { chunk: data.slice(0, 2000) });
      if (!runtime.closed && debugSseEnabled) {
        writeSseData(res, {
          type: "data-debug",
          data: { traceId, phase: "sdk_stderr", chunk: data.slice(0, 1200) }
        });
      }
    };

    if (gateEnabled) {
      options.canUseTool = async (toolName, input, hookOptions) => {
        const inputObj = (input ?? {}) as Record<string, unknown>;
        const isAskUserQuestion = isAskUserQuestionTool(toolName);
        if (!runtime.closed) {
          writeSseData(res, {
            type: "data-tool-gate-hit",
            data: {
              sessionId,
              toolName,
              isAskUserQuestion,
              toolUseID: hookOptions?.toolUseID
            }
          });
        }

        const kind: PendingRequestKind = isAskUserQuestion ? "ask_user_question" : "permission_request";
        turnTrace.phases.push({
          phase: kind === "ask_user_question" ? "waiting_user_input" : "waiting_permission",
          at: Date.now(),
          detail: normalizeToolLabel(toolName)
        });
        if (turnTrace.phases.length > 30) turnTrace.phases = turnTrace.phases.slice(-30);

        const notify: PendingNotify = (eventType, data) => {
          if (runtime.closed) return;
          writeSseData(res, { type: eventType, data });
        };

        const { requestId, createdAt, expiresAt, decisionPromise } = pendingStore.createPendingRequest(
          kind,
          sessionId,
          toolName,
          inputObj,
          hookOptions?.toolUseID,
          notify,
          hookOptions?.suggestions
        );

        writeDebugSse(res, runtime.closed, debugSseEnabled, traceId, "tool_permission_requested", {
          requestId,
          toolName,
          hasSuggestions: Array.isArray(hookOptions?.suggestions) && hookOptions.suggestions.length > 0,
          toolUseID: hookOptions?.toolUseID
        });

        notify(kind === "ask_user_question" ? "data-ask-user-question-created" : "data-permission-request-created", {
          requestId,
          sessionId,
          toolName,
          kind,
          input: inputObj,
          suggestions: hookOptions?.suggestions,
          toolUseID: hookOptions?.toolUseID,
          createdAt,
          expiresAt
        });

        return decisionPromise;
      };
    }

    queryInstance = query({ prompt: enhanced.prompt, options });
    activeQueries.set(key, queryInstance);
    writeDebugSse(res, runtime.closed, debugSseEnabled, traceId, "query_created", {
      workspaceId: workspace.id,
      sessionId,
      hasResume: Boolean(sdkSessionId)
    });

    if (shouldRunPerTurnMcpProbe()) {
      startMcpStatusProbe({ queryInstance, res, traceId, debugSseEnabled, runtime });
    }

    if (settings.debugEnabled) {
      if (shouldRunDebugProbesBlocking()) {
        await runDebugProbes({ queryInstance, res, traceId, debugSseEnabled, runtime });
      } else {
        void runDebugProbes({ queryInstance, res, traceId, debugSseEnabled, runtime }).catch((error) => {
          writeDebugSse(res, runtime.closed, debugSseEnabled, traceId, "probe_background_error", {
            error: error instanceof Error ? error.message : String(error)
          });
        });
      }
    }

    let mcpTogglePromise: Promise<void> | null = null;
    if (shouldRunPerTurnMcpToggle(settings)) {
      mcpTogglePromise = applyMcpToggle(queryInstance, workspace.root, settings.mcpEnabled)
        .then(() => {
          if (!runtime.closed) {
            writeSseData(res, { type: "data-mcp-toggled", data: { enabled: settings.mcpEnabled } });
          }
          writeDebugSse(res, runtime.closed, debugSseEnabled, traceId, "mcp_toggled", { enabled: settings.mcpEnabled });
        })
        .catch((error) => {
          writeDebugSse(res, runtime.closed, debugSseEnabled, traceId, "mcp_toggled_error", {
            error: error instanceof Error ? error.message : String(error)
          });
        });
    }

    const streamResult = await consumeQueryEvents({
      queryInstance,
      key,
      partId,
      traceId,
      res,
      runtime,
      debugSseEnabled,
      settingsDebugEnabled: settings.debugEnabled,
      sessionMap,
      sessionSeedMap,
      turnTrace
    });

    streamEventCount = streamResult.streamEventCount;
    deltaCount = streamResult.deltaCount;

    if (mcpTogglePromise) {
      await mcpTogglePromise;
    }

    if (!runtime.closed) {
      let assistantText = streamResult.assistantText;
      if (!assistantText.trim()) {
        assistantText = "本轮未收到模型文本输出，请重试或检查上游模型/网络状态。";
        writeSseData(res, { type: "text-delta", id: partId, delta: assistantText });
      }

      turnTrace.completedAt = Date.now();
      const persistedTrace: StoredToolTrace = {
        startedAt: turnTrace.startedAt,
        completedAt: turnTrace.completedAt,
        skills: turnTrace.skills,
        tools: turnTrace.tools,
        phases: turnTrace.phases,
        actions: turnTrace.actions
      };

      await appendSessionTurn(workspace.root, sessionId, rawMessage, assistantText, persistedTrace);
      logTrace(traceId, "stream_completed", {
        workspaceId: workspace.id,
        sessionId,
        streamEventCount,
        deltaCount
      });
      writeSseData(res, { type: "text-end", id: partId });
      writeSseData(res, { type: "finish" });
      writeSseDone(res);
      runtime.doneSent = true;
      clearInterval(heartbeat);
      res.end();
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    logTrace(traceId, "stream_error", { workspaceId: workspace.id, sessionId, error: msg, streamEventCount, deltaCount });
    if (!runtime.closed) {
      writeSseData(res, { type: "error", error: msg });
      writeSseData(res, { type: "finish" });
      writeSseDone(res);
      runtime.doneSent = true;
      clearInterval(heartbeat);
      res.end();
    }
  } finally {
    activeQueries.delete(key);
    logTrace(traceId, "request_finished", {
      workspaceId: workspace.id,
      sessionId,
      closed: runtime.closed,
      doneSent: runtime.doneSent,
      streamEventCount,
      deltaCount
    });
  }
}
