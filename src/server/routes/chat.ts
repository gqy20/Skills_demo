import { type Request, type Response } from "express";
import { type ChatRoutesDeps, sessionKey } from "./chat-shared.js";
import { handleChatUiRequest } from "./chat-ui.js";

function registerChatStopRoute({ app, workspaceRegistry, activeQueries }: ChatRoutesDeps): void {
  app.post("/api/chat/stop", async (req: Request, res: Response) => {
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

export function registerChatRoutes(deps: ChatRoutesDeps): void {
  deps.app.post("/api/chat/ui", async (req: Request, res: Response) => {
    await handleChatUiRequest(req, res, deps);
  });

  registerChatStopRoute(deps);
}
