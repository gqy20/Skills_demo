import path from "node:path";
import { promises as fs } from "node:fs";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { RuntimeSettings } from "../types.js";

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function getMcpServerNames(workspaceRoot: string): Promise<string[]> {
  try {
    const raw = await fs.readFile(path.join(workspaceRoot, ".mcp.json"), "utf-8");
    const parsed = JSON.parse(raw) as { mcpServers?: Record<string, unknown> };
    return Object.keys(parsed.mcpServers || {});
  } catch {
    return [];
  }
}

export async function applyMcpToggle(
  queryInstance: ReturnType<typeof query>,
  workspaceRoot: string,
  enabled: boolean
): Promise<void> {
  const names = await getMcpServerNames(workspaceRoot);
  if (names.length === 0) return;

  await Promise.all(
    names.map(async (name) => {
      try {
        await withTimeout(queryInstance.toggleMcpServer(name, enabled), 3000, `toggleMcpServer(${name})`);
      } catch {
        // Ignore individual MCP toggle errors to keep stream path resilient.
      }
    })
  );
}

function buildQueryEnv(settings: RuntimeSettings): Record<string, string | undefined> {
  return {
    ...(settings.runtimeEnv || {}),
    ANTHROPIC_MODEL: settings.model,
    ANTHROPIC_BASE_URL: settings.baseUrl,
    ANTHROPIC_AUTH_TOKEN: settings.authToken,
    ...process.env
  };
}

export function buildPermissionRuntimeOptions(
  settings: RuntimeSettings
): Pick<NonNullable<Parameters<typeof query>[0]["options"]>, "permissionMode" | "allowDangerouslySkipPermissions"> {
  if (settings.permissionProfile === "accept_edits") {
    return { permissionMode: "acceptEdits" };
  }
  if (settings.permissionProfile === "full_auto") {
    return {
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true
    };
  }
  return { permissionMode: "default" };
}

export function buildQueryOptions(
  workspaceRoot: string,
  settings: RuntimeSettings,
  sessionId: string,
  sdkSessionId: string | undefined,
  extra: Partial<Parameters<typeof query>[0]["options"]> = {}
): NonNullable<Parameters<typeof query>[0]["options"]> {
  const base: NonNullable<Parameters<typeof query>[0]["options"]> = {
    cwd: workspaceRoot,
    env: buildQueryEnv(settings),
    includePartialMessages: true,
    ...(sdkSessionId ? { resume: sdkSessionId } : { sessionId }),
    ...extra
  };

  if (settings.speedModeEnabled) {
    base.settingSources = [];
    base.thinking = { type: "disabled" };
  } else {
    base.settingSources = ["project"];
  }

  Object.assign(base, buildPermissionRuntimeOptions(settings));

  return base;
}
