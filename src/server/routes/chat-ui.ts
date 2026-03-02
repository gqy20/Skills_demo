import { randomUUID } from "node:crypto";
import { query, unstable_v2_createSession, unstable_v2_resumeSession, type PermissionUpdate } from "@anthropic-ai/claude-agent-sdk";
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

function createSessionRuntimePlaceholder() {
  return {
    close() {
      // placeholder runtime until persistent SDK session path is enabled
    }
  } as never;
}

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
  if (!gateEnabled) return undefined;
  return async (toolName: string, input?: unknown, hookOptions?: { toolUseID?: string; suggestions?: PermissionUpdate[] }) => {
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

export async function handleChatUiRequest(req: Request, res: Response, deps: ChatRoutesDeps): Promise<void> {
  const { workspaceRegistry, defaultSettings, sessionMap, sessionSeedMap, pendingStore, activeQueries, sessionRuntimeManager } =
    deps;
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
  let usePersistentSession = Boolean(sessionRuntimeManager);
  const runtime: RuntimeFlags = { closed: false, doneSent: false };
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

  let runtimeTurnAcquired = false;
  if (sessionRuntimeManager) {
    try {
      const acquired = sessionRuntimeManager.acquireTurn({
        workspaceId: workspace.id,
        sessionId,
        createSession: () => {
          const env = {
            ...(settings.runtimeEnv || {}),
            ANTHROPIC_MODEL: settings.model,
            ANTHROPIC_BASE_URL: settings.baseUrl,
            ANTHROPIC_AUTH_TOKEN: settings.authToken,
            ...process.env
          };
          const options = {
            model: settings.model,
            env,
            permissionMode:
              settings.permissionProfile === "accept_edits"
                ? ("acceptEdits" as const)
                : settings.permissionProfile === "full_auto"
                  ? ("dontAsk" as const)
                  : ("default" as const),
            canUseTool: canUseToolHandler
          };
          if (sdkSessionId) {
            return unstable_v2_resumeSession(sdkSessionId, options);
          }
          return unstable_v2_createSession(options);
        }
      });
      runtimeTurnAcquired = acquired.acquired;
      if (!acquired.acquired) {
        res.status(409).json({
          ok: false,
          error: "session is busy",
          workspaceId: workspace.id,
          id: sessionId
        });
        return;
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logTrace(traceId, "persistent_session_fallback", {
        workspaceId: workspace.id,
        sessionId,
        reason: "create_or_resume_failed",
        error: msg
      });
      usePersistentSession = false;
    }
  }

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("x-vercel-ai-ui-message-stream", "v1");
  res.flushHeaders();

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

  let queryInstance: ReturnType<typeof query> | null = null;
  let persistentSessionKey = "";
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
    } else if (sessionRuntimeManager && usePersistentSession && persistentSessionKey) {
      sessionRuntimeManager.close(persistentSessionKey);
    }
    activeQueries.delete(key);
    logTrace(traceId, "client_closed", { workspaceId: workspace.id, sessionId });
  });

  let streamEventCount = 0;
  let deltaCount = 0;

  try {
    let mcpTogglePromise: Promise<void> | null = null;
    let streamResult:
      | {
          assistantText: string;
          streamEventCount: number;
          deltaCount: number;
        }
      | null = null;

    if (usePersistentSession && sessionRuntimeManager) {
      persistentSessionKey = key;
      const runtimeSession = sessionRuntimeManager.get(key);
      if (!runtimeSession) {
        writeDebugSse(res, runtime.closed, debugSseEnabled, traceId, "persistent_session_fallback", {
          workspaceId: workspace.id,
          sessionId,
          reason: "runtime_missing"
        });
        usePersistentSession = false;
      }
    }

    if (usePersistentSession && sessionRuntimeManager) {
      const runtimeSession = sessionRuntimeManager.get(key);
      if (!runtimeSession) throw new Error("persistent session runtime missing");
      const sessionLike = runtimeSession.session as unknown as {
        mcpServerStatus?: () => Promise<unknown[]>;
        toggleMcpServer?: (name: string, enabled: boolean) => Promise<void>;
        accountInfo?: () => Promise<{ email?: string; organization?: string }>;
        supportedModels?: () => Promise<unknown[]>;
        initializationResult?: () => Promise<{ commands?: unknown[]; models?: unknown[] }>;
      };
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
        mcpTogglePromise = applyMcpToggle(sessionLike as never, workspace.root, settings.mcpEnabled)
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
        eventStream: runtimeSession.session.stream(),
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
        stopOnResult: true
      });
      await runtimeSession.session.send(enhanced.prompt);
      streamResult = await streamPromise;
      writeDebugSse(res, runtime.closed, debugSseEnabled, traceId, "persistent_session_turn", {
        workspaceId: workspace.id,
        sessionId,
        hasResume: Boolean(sdkSessionId)
      });
    } else {
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

      if (canUseToolHandler) options.canUseTool = canUseToolHandler;

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

      streamResult = await consumeQueryEvents({
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
        turnTrace
      });
    }

    if (!streamResult) {
      throw new Error("stream result missing");
    }

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
    if (runtimeTurnAcquired && sessionRuntimeManager) {
      sessionRuntimeManager.endTurn(key);
    }
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
