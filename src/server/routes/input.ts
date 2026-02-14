import type { Express } from "express";
import { PendingRequestStore } from "../services/pending.js";

type InputRoutesDeps = {
  app: Express;
  pendingStore: PendingRequestStore;
};

export function registerInputRoutes({ app, pendingStore }: InputRoutesDeps): void {
  app.post("/api/input", (req, res) => {
    const requestId = typeof req.body?.requestId === "string" ? req.body.requestId : "";
    const behavior = req.body?.behavior === "deny" ? "deny" : "allow";
    const message = typeof req.body?.message === "string" ? req.body.message : "User denied from web UI.";
    const updatedInput = req.body?.updatedInput;
    const alwaysAllow = req.body?.alwaysAllow === true;

    if (!requestId) {
      res.status(400).json({ error: "requestId is required" });
      return;
    }

    const result = pendingStore.resolveInput(requestId, behavior, message, updatedInput, alwaysAllow);
    if (result.type === "validation_error") {
      res.status(400).json({ error: result.message });
      return;
    }
    if (result.type === "not_found") {
      res.status(404).json({ error: "request not found" });
      return;
    }
    if (result.type === "idempotent") {
      res.json({ ok: true, requestId: result.requestId, status: result.status, idempotent: true });
      return;
    }
    res.json({ ok: true, requestId: result.requestId, status: result.status });
  });

  app.post("/api/input/cancel", (req, res) => {
    const requestId = typeof req.body?.requestId === "string" ? req.body.requestId : "";
    const message = typeof req.body?.message === "string" ? req.body.message : "Canceled by user from web UI.";
    if (!requestId) {
      res.status(400).json({ error: "requestId is required" });
      return;
    }

    const result = pendingStore.cancelInput(requestId, message);
    if (result.type === "not_found") {
      res.status(404).json({ error: "request not found" });
      return;
    }
    if (result.type === "idempotent") {
      res.json({ ok: true, requestId: result.requestId, status: result.status, idempotent: true });
      return;
    }
    res.json({ ok: true, requestId: result.requestId, status: result.status });
  });
}
