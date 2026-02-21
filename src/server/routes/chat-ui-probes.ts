import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Response } from "express";
import { writeSseData } from "../services/chat.js";
import { withTimeout } from "../services/query.js";
import { writeDebugSse } from "./chat-shared.js";

type ProbeParams = {
  queryInstance: ReturnType<typeof query>;
  res: Response;
  traceId: string;
  debugSseEnabled: boolean;
  runtime: { closed: boolean };
};

export function startMcpStatusProbe({ queryInstance, res, traceId, debugSseEnabled, runtime }: ProbeParams): void {
  void withTimeout(queryInstance.mcpServerStatus(), 10000, "mcpServerStatus")
    .then((status) => {
      if (!runtime.closed) {
        writeSseData(res, {
          type: "data-mcp-status",
          data: { ok: true, count: Array.isArray(status) ? status.length : 0 }
        });
      }
      writeDebugSse(res, runtime.closed, debugSseEnabled, traceId, "probe_mcp_status", {
        count: Array.isArray(status) ? status.length : 0
      });
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (!runtime.closed) {
        writeSseData(res, {
          type: "data-mcp-status",
          data: { ok: false, count: 0, error: message }
        });
      }
      writeDebugSse(res, runtime.closed, debugSseEnabled, traceId, "probe_mcp_status_error", { error: message });
    });
}

export async function runDebugProbes({ queryInstance, res, traceId, debugSseEnabled, runtime }: ProbeParams): Promise<void> {
  const [initProbe, accountProbe, mcpProbe, modelProbe] = await Promise.allSettled([
    withTimeout(queryInstance.initializationResult(), 5000, "initializationResult"),
    withTimeout(queryInstance.accountInfo(), 3000, "accountInfo"),
    withTimeout(queryInstance.mcpServerStatus(), 10000, "mcpServerStatus"),
    withTimeout(queryInstance.supportedModels(), 3000, "supportedModels")
  ]);

  if (initProbe.status === "fulfilled") {
    writeDebugSse(res, runtime.closed, debugSseEnabled, traceId, "probe_initialization", {
      hasCommands: Array.isArray(initProbe.value.commands),
      hasModels: Array.isArray(initProbe.value.models)
    });
  } else {
    writeDebugSse(res, runtime.closed, debugSseEnabled, traceId, "probe_initialization_error", {
      error: initProbe.reason instanceof Error ? initProbe.reason.message : String(initProbe.reason)
    });
  }

  if (accountProbe.status === "fulfilled") {
    writeDebugSse(res, runtime.closed, debugSseEnabled, traceId, "probe_account", {
      email: accountProbe.value.email || "",
      organization: accountProbe.value.organization || ""
    });
  } else {
    writeDebugSse(res, runtime.closed, debugSseEnabled, traceId, "probe_account_error", {
      error: accountProbe.reason instanceof Error ? accountProbe.reason.message : String(accountProbe.reason)
    });
  }

  if (mcpProbe.status === "fulfilled") {
    writeDebugSse(res, runtime.closed, debugSseEnabled, traceId, "probe_mcp_status", {
      count: mcpProbe.value.length
    });
  } else {
    writeDebugSse(res, runtime.closed, debugSseEnabled, traceId, "probe_mcp_status_error", {
      error: mcpProbe.reason instanceof Error ? mcpProbe.reason.message : String(mcpProbe.reason)
    });
  }

  if (modelProbe.status === "fulfilled") {
    writeDebugSse(res, runtime.closed, debugSseEnabled, traceId, "probe_supported_models", {
      count: modelProbe.value.length
    });
  } else {
    writeDebugSse(res, runtime.closed, debugSseEnabled, traceId, "probe_supported_models_error", {
      error: modelProbe.reason instanceof Error ? modelProbe.reason.message : String(modelProbe.reason)
    });
  }
}
