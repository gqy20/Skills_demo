import path from "node:path";
import { promises as fs } from "node:fs";

export type McpConfigItem = {
  name: string;
  type: string;
  endpoint: string;
  requiredEnvVars: string[];
};

type McpConfigShape = {
  mcpServers?: Record<string, unknown>;
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function collectTemplateVars(value: unknown, out: Set<string>): void {
  if (typeof value === "string") {
    const matches = value.matchAll(/\$\{([A-Z0-9_]+)\}/g);
    for (const m of matches) {
      const name = m[1];
      if (name) out.add(name);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectTemplateVars(item, out);
    return;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) collectTemplateVars(v, out);
  }
}

function parseMcpServerItem(name: string, raw: unknown): McpConfigItem {
  const obj = asObject(raw) || {};
  const type = typeof obj.type === "string" && obj.type.trim() ? obj.type.trim() : "unknown";
  const requiredEnvVars = new Set<string>();
  collectTemplateVars(obj, requiredEnvVars);

  let endpoint = "";
  if (type === "stdio") {
    const command = typeof obj.command === "string" ? obj.command.trim() : "";
    const args = Array.isArray(obj.args) ? obj.args.filter((x) => typeof x === "string").join(" ") : "";
    endpoint = `${command}${args ? ` ${args}` : ""}`.trim();
  } else {
    endpoint = typeof obj.url === "string" ? obj.url.trim() : "";
  }

  return { name, type, endpoint, requiredEnvVars: Array.from(requiredEnvVars).sort() };
}

export async function readMcpConfig(workspaceRoot: string): Promise<McpConfigItem[]> {
  try {
    const raw = await fs.readFile(path.join(workspaceRoot, ".mcp.json"), "utf-8");
    const parsed = JSON.parse(raw) as McpConfigShape;
    const servers = parsed?.mcpServers && typeof parsed.mcpServers === "object" ? parsed.mcpServers : {};
    return Object.entries(servers).map(([name, item]) => parseMcpServerItem(name, item));
  } catch {
    return [];
  }
}
