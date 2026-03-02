import { config as loadDotenv } from "dotenv";
import express from "express";
import cors from "cors";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { RuntimeSettings } from "./types.js";
import { PendingRequestStore } from "./services/pending.js";
import { WorkspaceRegistry } from "./services/workspaces.js";
import { SessionRuntimeManager } from "./services/session-runtime.js";
import { registerSystemRoutes } from "./routes/system.js";
import { registerChatRoutes } from "./routes/chat.js";
import { registerInputRoutes } from "./routes/input.js";

const app = express();
loadDotenv({ override: true });
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WEB_ROOT_DIST = path.resolve(__dirname, "../../dist/web");
if (!existsSync(path.join(WEB_ROOT_DIST, "index.html"))) {
  throw new Error("Web assets not found in dist/web. Run `npm run build:web` first.");
}
const WEB_ROOT = WEB_ROOT_DIST;

const workspaceRegistry = new WorkspaceRegistry();
const pendingStore = new PendingRequestStore();
const sessionMap = new Map<string, string>();
const sessionSeedMap = new Map<string, string>();
const activeQueries = new Map<string, { mcpServerStatus: () => Promise<unknown[]>; interrupt: () => Promise<void> }>();
const sessionRuntimeManager = new SessionRuntimeManager({
  maxSessions: Number(process.env.CHAT_PERSISTENT_MAX_SESSIONS || 100),
  idleTtlMs: Number(process.env.CHAT_PERSISTENT_IDLE_TTL_MS || 10 * 60_000)
});
const cleanupIntervalMs = Number(process.env.CHAT_PERSISTENT_CLEANUP_INTERVAL_MS || 60_000);
const timer = setInterval(() => {
  const closed = sessionRuntimeManager.closeIdle();
  if (closed > 0) {
    console.log(JSON.stringify({ ts: new Date().toISOString(), phase: "persistent_session_cleanup", closed }));
  }
}, cleanupIntervalMs);
if (typeof timer.unref === "function") timer.unref();

const defaultSettings: RuntimeSettings = {
  model: process.env.ANTHROPIC_MODEL || "glm-5",
  baseUrl: process.env.ANTHROPIC_BASE_URL || "https://open.bigmodel.cn/api/anthropic",
  authToken: process.env.ANTHROPIC_AUTH_TOKEN || "",
  runtimeEnv: {},
  permissionProfile: "standard",
  mcpEnabled: true,
  speedModeEnabled: false,
  toolGateEnabled: true,
  debugEnabled: process.env.AGENT_WEB_DEBUG_ENABLED === "1",
  debugSseEnabled: process.env.AGENT_WEB_DEBUG_SSE_ENABLED === "1"
};

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(WEB_ROOT));

registerSystemRoutes({
  app,
  workspaceRegistry,
  defaultSettings,
  activeQueries,
  sessionRuntimeManager
});

registerChatRoutes({
  app,
  workspaceRegistry,
  pendingStore,
  defaultSettings,
  sessionMap,
  sessionSeedMap,
  activeQueries,
  sessionRuntimeManager
});

registerInputRoutes({ app, pendingStore });

app.get("*", (_req, res) => {
  res.sendFile(path.join(WEB_ROOT, "index.html"));
});

app.listen(port, host, () => {
  console.log(`Agent web server running at http://${host}:${port}`);
});
