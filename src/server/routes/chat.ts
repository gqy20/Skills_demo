import { type Request, type Response } from "express";
import { type ChatRoutesDeps, sessionKey } from "./chat-shared.js";
import { handleChatUiRequest } from "./chat-ui.js";

function registerChatStopRoute({ app, workspaceRegistry, sessionRuntimeManager, activeQueries }: ChatRoutesDeps): void {
  app.post("/api/chat/stop", async (req: Request, res: Response) => {
    const workspace = workspaceRegistry.requireWorkspace(req, res);
    if (!workspace) return;

    const sessionId = typeof req.body?.id === "string" ? req.body.id : "";
    if (!sessionId) {
      res.status(400).json({ error: "id is required" });
      return;
    }

    const key = sessionKey(workspace.id, sessionId);
    let queryInterrupted = false;
    const activeQuery = activeQueries?.get(key) || null;
    if (activeQuery?.interrupt) {
      try {
        await activeQuery.interrupt();
        queryInterrupted = true;
      } catch {
        // Ignore interrupt failures and keep fallback behavior.
      } finally {
        activeQueries?.delete(key);
      }
    }
    const runtimeClosed = sessionRuntimeManager?.close(key) === true;
    res.json({
      ok: true,
      workspaceId: workspace.id,
      id: sessionId,
      stopped: queryInterrupted || runtimeClosed,
      reason: queryInterrupted ? "query_interrupted" : runtimeClosed ? "runtime_closed" : "no_active_session"
    });
  });
}

export function registerChatRoutes(deps: ChatRoutesDeps): void {
  deps.app.post("/api/chat/ui", async (req: Request, res: Response) => {
    await handleChatUiRequest(req, res, deps);
  });

  registerChatStopRoute(deps);
}
