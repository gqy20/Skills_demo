import { randomUUID } from "node:crypto";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Express, Response } from "express";
import type { RuntimeSettings } from "../types.js";
import {
  enhancePromptWithDirectives,
  extractDeltaText,
  extractPrompt,
  extractResultText,
  extractSdkLifecycle,
  parsePromptDirectives,
  writeSseData,
  writeSseDone
} from "../services/chat.js";
import { readSettings } from "../services/settings.js";
import { type PendingNotify, type PendingRequestKind, PendingRequestStore } from "../services/pending.js";
import { WorkspaceRegistry } from "../services/workspaces.js";
import { applyMcpToggle, buildQueryOptions, withTimeout } from "../services/query.js";
import { fetchSkills } from "../services/skills.js";

type ChatRoutesDeps = {
  app: Express;
  workspaceRegistry: WorkspaceRegistry;
  pendingStore: PendingRequestStore;
  defaultSettings: RuntimeSettings;
  sessionMap: Map<string, string>;
  sessionSeedMap: Map<string, string>;
  activeQueries: Map<string, ReturnType<typeof query>>;
};

function sessionKey(workspaceId: string, sessionId: string): string {
  return `${workspaceId}:${sessionId}`;
}

function logTrace(traceId: string, phase: string, data: Record<string, unknown> = {}): void {
  const line = {
    ts: new Date().toISOString(),
    traceId,
    phase,
    ...data
  };
  console.log(JSON.stringify(line));
}

function isAskUserQuestionTool(toolName: string): boolean {
  return toolName.trim().toLowerCase() === "askuserquestion";
}

function writeDebugSse(
  res: Response,
  closed: boolean,
  enabled: boolean,
  traceId: string,
  phase: string,
  data: Record<string, unknown> = {}
): void {
  logTrace(traceId, phase, data);
  if (!enabled || closed) return;
  writeSseData(res, {
    type: "data-debug",
    data: {
      traceId,
      phase,
      ...data
    }
  });
}

export function registerChatRoutes({
  app,
  workspaceRegistry,
  pendingStore,
  defaultSettings,
  sessionMap,
  sessionSeedMap,
  activeQueries
}: ChatRoutesDeps): void {
  app.post("/api/chat/ui", async (req, res) => {
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
      try {
        const skills = await fetchSkills(workspace.root, settings, { buildQueryOptions, withTimeout });
        availableSlashNames = new Set(skills.map((item) => String(item.name || "").trim().toLowerCase()).filter(Boolean));
      } catch {
        availableSlashNames = null;
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

    let closed = false;
    let queryInstance: ReturnType<typeof query> | null = null;
    let streamEventCount = 0;
    let deltaCount = 0;
    let doneSent = false;
    const heartbeat = setInterval(() => {
      if (!closed) {
        res.write(": heartbeat\n\n");
      }
    }, 15000);

    req.on("close", () => {
      closed = true;
      clearInterval(heartbeat);
      if (queryInstance) {
        try {
          queryInstance.close();
        } catch {
          // ignore close errors on disconnect
        }
      }
      activeQueries.delete(key);
      logTrace(traceId, "client_closed", { workspaceId: workspace.id, sessionId, streamEventCount, deltaCount });
    });

    try {
      const options = buildQueryOptions(workspace.root, settings, sessionId, sdkSessionId);
      if (!sdkSessionId) {
        options.sessionId = seededSdkSessionId;
        delete options.resume;
      }
      options.debug = settings.debugEnabled;
      options.stderr = (data) => {
        logTrace(traceId, "sdk_stderr", { chunk: data.slice(0, 2000) });
        if (!closed && debugSseEnabled) {
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
          if (!closed) {
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
          const notify: PendingNotify = (eventType, data) => {
            if (closed) return;
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
          writeDebugSse(res, closed, debugSseEnabled, traceId, "tool_permission_requested", {
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
      writeDebugSse(res, closed, debugSseEnabled, traceId, "query_created", {
        workspaceId: workspace.id,
        sessionId,
        hasResume: Boolean(sdkSessionId)
      });

      if (settings.debugEnabled) {
        const [initProbe, accountProbe, mcpProbe, modelProbe] = await Promise.allSettled([
          withTimeout(queryInstance.initializationResult(), 5000, "initializationResult"),
          withTimeout(queryInstance.accountInfo(), 3000, "accountInfo"),
          withTimeout(queryInstance.mcpServerStatus(), 3000, "mcpServerStatus"),
          withTimeout(queryInstance.supportedModels(), 3000, "supportedModels")
        ]);

        if (initProbe.status === "fulfilled") {
          writeDebugSse(res, closed, debugSseEnabled, traceId, "probe_initialization", {
            hasCommands: Array.isArray(initProbe.value.commands),
            hasModels: Array.isArray(initProbe.value.models)
          });
        } else {
          writeDebugSse(res, closed, debugSseEnabled, traceId, "probe_initialization_error", {
            error: initProbe.reason instanceof Error ? initProbe.reason.message : String(initProbe.reason)
          });
        }

        if (accountProbe.status === "fulfilled") {
          writeDebugSse(res, closed, debugSseEnabled, traceId, "probe_account", {
            email: accountProbe.value.email || "",
            organization: accountProbe.value.organization || ""
          });
        } else {
          writeDebugSse(res, closed, debugSseEnabled, traceId, "probe_account_error", {
            error: accountProbe.reason instanceof Error ? accountProbe.reason.message : String(accountProbe.reason)
          });
        }

        if (mcpProbe.status === "fulfilled") {
          writeDebugSse(res, closed, debugSseEnabled, traceId, "probe_mcp_status", {
            count: mcpProbe.value.length
          });
        } else {
          writeDebugSse(res, closed, debugSseEnabled, traceId, "probe_mcp_status_error", {
            error: mcpProbe.reason instanceof Error ? mcpProbe.reason.message : String(mcpProbe.reason)
          });
        }

        if (modelProbe.status === "fulfilled") {
          writeDebugSse(res, closed, debugSseEnabled, traceId, "probe_supported_models", {
            count: modelProbe.value.length
          });
        } else {
          writeDebugSse(res, closed, debugSseEnabled, traceId, "probe_supported_models_error", {
            error: modelProbe.reason instanceof Error ? modelProbe.reason.message : String(modelProbe.reason)
          });
        }
      }

      if (!settings.speedModeEnabled) {
        await applyMcpToggle(queryInstance, workspace.root, settings.mcpEnabled);
        if (!closed) {
          writeSseData(res, { type: "data-mcp-toggled", data: { enabled: settings.mcpEnabled } });
        }
        writeDebugSse(res, closed, debugSseEnabled, traceId, "mcp_toggled", { enabled: settings.mcpEnabled });
      }

      for await (const event of queryInstance) {
        if (closed) break;
        streamEventCount += 1;

        if (typeof event.session_id === "string") {
          sessionMap.set(key, event.session_id);
          sessionSeedMap.delete(key);
        }

        if (event.type === "system" && event.subtype === "init" && !closed) {
          const tools = Array.isArray(event.tools) ? event.tools : [];
          writeSseData(res, {
            type: "data-sdk-init",
            data: {
              model: event.model || "",
              permissionMode: event.permissionMode || "",
              toolCount: tools.length,
              tools: tools.slice(0, 80),
              hasAskUserQuestionTool: tools.some((tool) => tool.trim().toLowerCase() === "askuserquestion")
            }
          });
        }

        const deltaText = extractDeltaText(event);
        if (deltaText) {
          deltaCount += 1;
          writeSseData(res, { type: "text-delta", id: partId, delta: deltaText });
        }

        const resultText = extractResultText(event);
        if (resultText && deltaCount === 0) {
          deltaCount += 1;
          writeSseData(res, { type: "text-delta", id: partId, delta: resultText });
        }

        const lifecycle = extractSdkLifecycle(event);
        if (lifecycle) {
          if (lifecycle.category === "tool_progress" && !closed) {
            writeSseData(res, {
              type: "data-tool-progress",
              data: {
                toolName: lifecycle.toolName || "",
                toolUseId: lifecycle.toolUseId || "",
                elapsedSeconds: lifecycle.elapsedSeconds ?? null
              }
            });
          }
          if (lifecycle.category === "tool_use_summary" && !closed) {
            writeSseData(res, {
              type: "data-tool-use-summary",
              data: {
                summary: lifecycle.summary || ""
              }
            });
          }
          writeDebugSse(res, closed, debugSseEnabled, traceId, "sdk_lifecycle", lifecycle);
        }

        if (event.type === "result" && event.is_error) {
          const maybeErrors = "errors" in event ? event.errors : undefined;
          const firstError = Array.isArray(maybeErrors) && maybeErrors.length > 0 ? String(maybeErrors[0]) : "";
          const message = firstError || `SDK result error: ${event.subtype}`;
          writeSseData(res, { type: "error", error: message });
        }

        if (settings.debugEnabled && debugSseEnabled && streamEventCount <= 30) {
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

      if (!closed) {
        logTrace(traceId, "stream_completed", {
          workspaceId: workspace.id,
          sessionId,
          streamEventCount,
          deltaCount
        });
        writeSseData(res, { type: "text-end", id: partId });
        writeSseData(res, { type: "finish" });
        writeSseDone(res);
        doneSent = true;
        clearInterval(heartbeat);
        res.end();
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      logTrace(traceId, "stream_error", { workspaceId: workspace.id, sessionId, error: msg, streamEventCount, deltaCount });
      if (!closed) {
        writeSseData(res, { type: "error", error: msg });
        writeSseData(res, { type: "finish" });
        writeSseDone(res);
        doneSent = true;
        clearInterval(heartbeat);
        res.end();
      }
    } finally {
      activeQueries.delete(key);
      logTrace(traceId, "request_finished", {
        workspaceId: workspace.id,
        sessionId,
        closed,
        doneSent,
        streamEventCount,
        deltaCount
      });
    }
  });

  app.post("/api/chat/stop", async (req, res) => {
    const workspace = workspaceRegistry.requireWorkspace(req, res);
    if (!workspace) return;
    const sessionId = typeof req.body?.id === "string" ? req.body.id : "";
    if (!sessionId) {
      res.status(400).json({ error: "id is required" });
      return;
    }

    const key = sessionKey(workspace.id, sessionId);
    const queryInstance = activeQueries.get(key);
    if (!queryInstance) {
      res.json({ ok: true, workspaceId: workspace.id, id: sessionId, stopped: false, reason: "no_active_query" });
      return;
    }

    try {
      await queryInstance.interrupt();
    } catch {
      // ignore interrupt errors and proceed to close
    }

    try {
      queryInstance.close();
    } catch {
      // ignore close errors
    }
    activeQueries.delete(key);
    res.json({ ok: true, workspaceId: workspace.id, id: sessionId, stopped: true });
  });
}
