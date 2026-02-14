import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { RuntimeSettings } from "./types.js";
import { PendingRequestStore } from "./services/pending.js";
import { WorkspaceRegistry } from "./services/workspaces.js";
import { registerSystemRoutes } from "./routes/system.js";
import { registerChatRoutes } from "./routes/chat.js";
import { registerInputRoutes } from "./routes/input.js";

const app = express();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WEB_ROOT = path.resolve(__dirname, "../web");

const workspaceRegistry = new WorkspaceRegistry();
const pendingStore = new PendingRequestStore();
const sessionMap = new Map<string, string>();
const sessionSeedMap = new Map<string, string>();
const activeQueries = new Map<string, ReturnType<typeof query>>();

const defaultSettings: RuntimeSettings = {
  model: process.env.ANTHROPIC_MODEL || "glm-5",
  baseUrl: process.env.ANTHROPIC_BASE_URL || "https://open.bigmodel.cn/api/anthropic",
  authToken: process.env.ANTHROPIC_AUTH_TOKEN || "",
  mcpEnabled: true,
  speedModeEnabled: false,
  toolGateEnabled: true,
  debugEnabled: process.env.AGENT_WEB_DEBUG === "1",
  debugSseEnabled: process.env.AGENT_WEB_DEBUG_SSE === "1"
};

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(WEB_ROOT));

registerSystemRoutes({
  app,
  workspaceRegistry,
  defaultSettings
});

registerChatRoutes({
  app,
  workspaceRegistry,
  pendingStore,
  defaultSettings,
  sessionMap,
  sessionSeedMap,
  activeQueries
});

registerInputRoutes({ app, pendingStore });

app.get("*", (_req, res) => {
  res.sendFile(path.join(WEB_ROOT, "index.html"));
});

app.listen(port, host, () => {
  console.log(`Agent web server running at http://${host}:${port}`);
});
