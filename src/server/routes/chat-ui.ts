import { randomUUID } from "node:crypto";
import { query, type PermissionResult, type PermissionUpdate } from "@anthropic-ai/claude-agent-sdk";
import type { Request, Response } from "express";
import {
  buildRestartRecoveryPayload,
  enhancePromptWithDirectives,
  extractPrompt,
  parsePromptDirectives,
  writeSseData,
  writeSseDone
} from "../services/chat.js";
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
import {
  shouldRunDebugProbesBlocking,
  shouldRunPerTurnMcpProbe,
  shouldRunPerTurnMcpToggle
} from "./chat-ui-optimization.js";
import { resolveAvailableSlashNames } from "./chat-ui-slash-cache.js";

type RuntimeFlags = {
  closed: boolean;
  doneSent: boolean;
  phase: string;
  phaseStartedAt: number;
  lastActivityAt: number;
};

function buildCanUseToolHandler(params: {
  gateEnabled: boolean;
  runtime: RuntimeFlags;
  res: Response;
  sessionId: string;
  pendingStore: ChatRoutesDeps["pendingStore"];
  turnTrace: ReturnType<typeof createTurnTrace>;
  traceId: string;
  debugSseEnabled: boolean;
}) {
  const { gateEnabled, runtime, res, sessionId, pendingStore, turnTrace, traceId, debugSseEnabled } = params;
  return async (toolName: string, input?: unknown, hookOptions?: { toolUseID?: string; suggestions?: PermissionUpdate[] }) => {
    const inputObj = (input ?? {}) as Record<string, unknown>;
    const normalizedToolName = String(toolName || "").trim().toLowerCase();
    const isMcpTool = normalizedToolName.startsWith("mcp__") || normalizedToolName.startsWith("mcp:");
    if (isMcpTool) {
      if (!runtime.closed) {
        writeSseData(res, {
          type: "data-tool-gate-hit",
          data: {
            sessionId,
            toolName,
            isAskUserQuestion: false,
            toolUseID: hookOptions?.toolUseID,
            autoAllowed: true
          }
        });
      }
      writeDebugSse(res, runtime.closed, debugSseEnabled, traceId, "tool_permission_auto_allowed", {
        toolName,
        toolUseID: hookOptions?.toolUseID,
        reason: "mcp_default_allow"
      });
      const decision: PermissionResult = {
        behavior: "allow",
        updatedInput: inputObj
      };
      return decision;
    }
    if (!gateEnabled) {
      if (!runtime.closed) {
        writeSseData(res, {
          type: "data-tool-gate-hit",
          data: {
            sessionId,
            toolName,
            isAskUserQuestion: false,
            toolUseID: hookOptions?.toolUseID,
            autoAllowed: true
          }
        });
      }
      writeDebugSse(res, runtime.closed, debugSseEnabled, traceId, "tool_permission_auto_allowed", {
        toolName,
        toolUseID: hookOptions?.toolUseID,
        reason: "tool_gate_disabled"
      });
      return {
        behavior: "allow",
        updatedInput: inputObj
      } as PermissionResult;
    }
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

  const settings = await readSettings(workspace.root, defaultSettings);
  const parsedDirectives = parsePromptDirectives(rawMessage);
  let availableSlashNames: Set<string> | null = null;
  let slashNamesSource: "fetched" | "cache_fresh" | "cache_stale_on_error" | "unavailable" | "none" = "none";
  if (parsedDirectives.slash) {
    const slashResolution = await resolveAvailableSlashNames(workspace.root, settings, {
      fetchSkills: (workspaceRoot, runtimeSettings) =>
        fetchSkills(workspaceRoot, runtimeSettings, { buildQueryOptions, withTimeout })
    });
    availableSlashNames = slashResolution.names;
    slashNamesSource = slashResolution.source;
    if (slashResolution.source === "cache_stale_on_error" || slashResolution.source === "unavailable") {
      logTrace(traceId, "slash_names_resolution_degraded", {
        workspaceId: workspace.id,
        sessionId,
        source: slashResolution.source,
        error: slashResolution.error
      });
      writeDebugSse(
        res,
        false,
        settings.debugEnabled && settings.debugSseEnabled,
        traceId,
        "slash_names_resolution_degraded",
        {
          source: slashResolution.source,
          error: slashResolution.error
        }
      );
    }
  }

  const enhanced = await enhancePromptWithDirectives(workspace.root, rawMessage, availableSlashNames, { rewriteOwnedSlash: false });
  const slashRewritten =
    Boolean(enhanced.directives.slash?.name) &&
    Boolean(availableSlashNames && availableSlashNames.has(enhanced.directives.slash?.name || ""));
  const recovery = sdkSessionId
    ? { prompt: enhanced.prompt, replayedMessageCount: 0 }
    : buildRestartRecoveryPayload(req.body?.messages, enhanced.prompt);
  const promptForQuery = recovery.prompt;
  const gateEnabled = settings.permissionProfile === "standard" && settings.toolGateEnabled;
  const debugSseEnabled = settings.debugEnabled && settings.debugSseEnabled;
  const partId = `text-${randomUUID()}`;
  const now = Date.now();
  const runtime: RuntimeFlags = {
    closed: false,
    doneSent: false,
    phase: "queued",
    phaseStartedAt: now,
    lastActivityAt: now
  };
  const turnTrace = createTurnTrace();
  const canUseToolHandler = buildCanUseToolHandler({
    gateEnabled,
    runtime,
    res,
    sessionId,
    pendingStore,
    turnTrace,
    traceId,
    debugSseEnabled
  });

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("x-vercel-ai-ui-message-stream", "v1");
  res.flushHeaders();

  writeSseData(res, { type: "start" });
  writeSseData(res, { type: "text-start", id: partId });
  writeSseData(res, { type: "data-session", data: { sessionId } });
  writeSseData(res, {
    type: "data-runtime-phase",
    data: {
      phase: "queued",
      detail: "请求已提交，等待执行",
      at: now,
      etaSeconds: 3
    }
  });
  writeSseData(res, {
    type: "data-runtime-activity",
    data: {
      detail: "已接收用户请求，正在准备执行环境",
      at: now
    }
  });
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
    usedRecoveryPath: !sdkSessionId,
    replayedHistory: recovery.replayedMessageCount > 0,
    replayedMessageCount: recovery.replayedMessageCount,
    seededSdkSessionId,
    speedModeEnabled: settings.speedModeEnabled,
    mcpEnabled: settings.mcpEnabled,
    toolGateEnabled: gateEnabled,
    permissionProfile: settings.permissionProfile,
    hasSlash: Boolean(enhanced.directives.slash),
    slashRewritten,
    unknownSlash: enhanced.unknownSlash || "",
    mentionCount: enhanced.directives.mentionTokens.length,
    mentionResolvedCount: enhanced.mentionResolved.length,
    slashNamesSource
  });

  const heartbeat = setInterval(() => {
    if (!runtime.closed) {
      res.write(": heartbeat\n\n");
      const ts = Date.now();
      writeSseData(res, {
        type: "data-runtime-heartbeat",
        data: {
          phase: runtime.phase,
          phaseElapsedSeconds: Math.max(0, Math.floor((ts - runtime.phaseStartedAt) / 1000)),
          idleSeconds: Math.max(0, Math.floor((ts - runtime.lastActivityAt) / 1000)),
          at: ts
        }
      });
    }
  }, 3000);

  req.on("close", () => {
    runtime.closed = true;
    clearInterval(heartbeat);
    if (activeQueries) activeQueries.delete(key);
    logTrace(traceId, "client_closed", { workspaceId: workspace.id, sessionId });
  });

  let streamEventCount = 0;
  let deltaCount = 0;

  try {
    let mcpTogglePromise: Promise<void> | null = null;
    const options = buildQueryOptions(workspace.root, settings, seededSdkSessionId, sdkSessionId, {
      canUseTool: canUseToolHandler
    });
    const queryInstance = query({
      prompt: promptForQuery,
      options
    });
    const sessionLike = queryInstance as unknown as {
      interrupt?: () => Promise<void>;
      mcpServerStatus?: () => Promise<unknown[]>;
      toggleMcpServer?: (name: string, enabled: boolean) => Promise<void>;
      accountInfo?: () => Promise<{ email?: string; organization?: string }>;
      supportedModels?: () => Promise<unknown[]>;
      initializationResult?: () => Promise<{ commands?: unknown[]; models?: unknown[] }>;
    };
    activeQueries?.set(key, queryInstance as unknown as { mcpServerStatus: () => Promise<unknown[]>; interrupt: () => Promise<void> });
    if (settings.debugEnabled) {
      const caps = {
        hasInitializationResult: typeof sessionLike.initializationResult === "function",
        hasAccountInfo: typeof sessionLike.accountInfo === "function",
        hasMcpServerStatus: typeof sessionLike.mcpServerStatus === "function",
        hasSupportedModels: typeof sessionLike.supportedModels === "function"
      };
      writeDebugSse(res, runtime.closed, debugSseEnabled, traceId, "persistent_debug_capabilities", caps);
      const runPersistentDebug = async () => {
        if (typeof sessionLike.initializationResult === "function") {
          const init = await withTimeout(sessionLike.initializationResult(), 5000, "initializationResult");
          writeDebugSse(res, runtime.closed, debugSseEnabled, traceId, "probe_initialization", {
            hasCommands: Array.isArray(init?.commands),
            hasModels: Array.isArray(init?.models)
          });
        } else {
          writeDebugSse(res, runtime.closed, debugSseEnabled, traceId, "probe_initialization_unsupported", {});
        }
        if (typeof sessionLike.accountInfo === "function") {
          const info = await withTimeout(sessionLike.accountInfo(), 3000, "accountInfo");
          writeDebugSse(res, runtime.closed, debugSseEnabled, traceId, "probe_account", {
            email: info?.email || "",
            organization: info?.organization || ""
          });
        } else {
          writeDebugSse(res, runtime.closed, debugSseEnabled, traceId, "probe_account_unsupported", {});
        }
        if (typeof sessionLike.supportedModels === "function") {
          const models = await withTimeout(sessionLike.supportedModels(), 3000, "supportedModels");
          writeDebugSse(res, runtime.closed, debugSseEnabled, traceId, "probe_supported_models", {
            count: Array.isArray(models) ? models.length : 0
          });
        } else {
          writeDebugSse(res, runtime.closed, debugSseEnabled, traceId, "probe_supported_models_unsupported", {});
        }
        if (typeof sessionLike.mcpServerStatus === "function") {
          const status = await withTimeout(sessionLike.mcpServerStatus(), 10000, "mcpServerStatus");
          writeDebugSse(res, runtime.closed, debugSseEnabled, traceId, "probe_mcp_status", {
            count: Array.isArray(status) ? status.length : 0
          });
        } else {
          writeDebugSse(res, runtime.closed, debugSseEnabled, traceId, "probe_mcp_status_unsupported", {});
        }
      };
      if (shouldRunDebugProbesBlocking()) {
        await runPersistentDebug().catch((error) => {
          writeDebugSse(res, runtime.closed, debugSseEnabled, traceId, "probe_background_error", {
            error: error instanceof Error ? error.message : String(error)
          });
        });
      } else {
        void runPersistentDebug().catch((error) => {
          writeDebugSse(res, runtime.closed, debugSseEnabled, traceId, "probe_background_error", {
            error: error instanceof Error ? error.message : String(error)
          });
        });
      }
    }
    if (shouldRunPerTurnMcpProbe() && typeof sessionLike.mcpServerStatus === "function") {
      void withTimeout(sessionLike.mcpServerStatus(), 10000, "mcpServerStatus")
        .then((status) => {
          if (!runtime.closed) {
            writeSseData(res, {
              type: "data-mcp-status",
              data: { ok: true, count: Array.isArray(status) ? status.length : 0 }
            });
          }
        })
        .catch((error) => {
          if (!runtime.closed) {
            writeSseData(res, {
              type: "data-mcp-status",
              data: { ok: false, count: 0, error: error instanceof Error ? error.message : String(error) }
            });
          }
        });
    }
    if (shouldRunPerTurnMcpToggle(settings) && typeof sessionLike.toggleMcpServer === "function") {
      const mcpToggleClient = { toggleMcpServer: sessionLike.toggleMcpServer.bind(sessionLike) };
      mcpTogglePromise = applyMcpToggle(mcpToggleClient, workspace.root, settings.mcpEnabled)
        .then(() => {
          if (!runtime.closed) {
            writeSseData(res, { type: "data-mcp-toggled", data: { enabled: settings.mcpEnabled } });
          }
        })
        .catch((error) => {
          writeDebugSse(res, runtime.closed, debugSseEnabled, traceId, "mcp_toggled_error", {
            error: error instanceof Error ? error.message : String(error)
          });
        });
    }
    const streamPromise = consumeQueryEvents({
      eventStream: queryInstance,
      key,
      partId,
      traceId,
      res,
      runtime,
      debugSseEnabled,
      settingsDebugEnabled: settings.debugEnabled,
      sessionMap,
      sessionSeedMap,
      turnTrace,
      stopOnResult: true,
      onRuntimePhase: (next) => {
        const ts = Date.now();
        runtime.phase = String(next.phase || runtime.phase);
        runtime.phaseStartedAt = ts;
        runtime.lastActivityAt = ts;
      },
      onRuntimeActivity: () => {
        runtime.lastActivityAt = Date.now();
      },
      onRuntimeHeartbeat: () => {
        runtime.lastActivityAt = Date.now();
      }
    });
    const streamResult = await streamPromise;
    writeDebugSse(res, runtime.closed, debugSseEnabled, traceId, "query_turn", {
      workspaceId: workspace.id,
      sessionId,
      hasResume: Boolean(sdkSessionId)
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
      activeQueries?.delete(key);
      clearInterval(heartbeat);
      res.end();
    }
    queryInstance.close();
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    logTrace(traceId, "stream_error", { workspaceId: workspace.id, sessionId, error: msg, streamEventCount, deltaCount });
    if (!runtime.closed) {
      writeSseData(res, { type: "error", error: msg });
      writeSseData(res, { type: "finish" });
      writeSseDone(res);
      runtime.doneSent = true;
      activeQueries?.delete(key);
      clearInterval(heartbeat);
      res.end();
    }
  } finally {
    activeQueries?.delete(key);
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
