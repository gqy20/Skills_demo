import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { registerInputRoutes } from "../../../src/server/routes/input.js";

type Handler = (req: Request, res: Response) => void;

type MockRes = Response & {
  statusCode: number;
  body: unknown;
};

function makeMockRes(): MockRes {
  let statusCode = 200;
  let body: unknown = null;
  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(data: unknown) {
      body = data;
      return this;
    },
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body;
    }
  };
  return res as unknown as MockRes;
}

describe("registerInputRoutes", () => {
  it("maps /api/input outcomes to expected response codes", () => {
    const routes = new Map<string, Handler>();
    const app = {
      post(path: string, handler: Handler) {
        routes.set(path, handler);
      }
    };
    const pendingStore = {
      resolveInput: vi
        .fn()
        .mockReturnValueOnce({ type: "validation_error", message: "bad payload" })
        .mockReturnValueOnce({ type: "not_found" })
        .mockReturnValueOnce({ type: "idempotent", requestId: "r1", status: "deny" })
        .mockReturnValueOnce({ type: "resolved", requestId: "r2", status: "allow" }),
      cancelInput: vi.fn()
    };

    registerInputRoutes({ app: app as never, pendingStore: pendingStore as never });
    const handler = routes.get("/api/input");
    expect(handler).toBeTypeOf("function");

    const missingReq = { body: {} } as Request;
    const missingRes = makeMockRes();
    handler!(missingReq, missingRes);
    expect(missingRes.statusCode).toBe(400);
    expect(missingRes.body).toEqual({ error: "requestId is required" });

    const reqBase = { body: { requestId: "r" } } as Request;
    const res1 = makeMockRes();
    handler!(reqBase, res1);
    expect(res1.statusCode).toBe(400);
    expect(res1.body).toEqual({ error: "bad payload" });

    const res2 = makeMockRes();
    handler!(reqBase, res2);
    expect(res2.statusCode).toBe(404);
    expect(res2.body).toEqual({ error: "request not found" });

    const res3 = makeMockRes();
    handler!(reqBase, res3);
    expect(res3.statusCode).toBe(200);
    expect(res3.body).toEqual({ ok: true, requestId: "r1", status: "deny", idempotent: true });

    const res4 = makeMockRes();
    handler!(reqBase, res4);
    expect(res4.statusCode).toBe(200);
    expect(res4.body).toEqual({ ok: true, requestId: "r2", status: "allow" });
  });

  it("maps /api/input/cancel outcomes to expected response codes", () => {
    const routes = new Map<string, Handler>();
    const app = {
      post(path: string, handler: Handler) {
        routes.set(path, handler);
      }
    };
    const pendingStore = {
      resolveInput: vi.fn(),
      cancelInput: vi
        .fn()
        .mockReturnValueOnce({ type: "not_found" })
        .mockReturnValueOnce({ type: "idempotent", requestId: "r1", status: "canceled" })
        .mockReturnValueOnce({ type: "resolved", requestId: "r2", status: "canceled" })
    };

    registerInputRoutes({ app: app as never, pendingStore: pendingStore as never });
    const handler = routes.get("/api/input/cancel");
    expect(handler).toBeTypeOf("function");

    const missingReq = { body: {} } as Request;
    const missingRes = makeMockRes();
    handler!(missingReq, missingRes);
    expect(missingRes.statusCode).toBe(400);
    expect(missingRes.body).toEqual({ error: "requestId is required" });

    const reqBase = { body: { requestId: "r" } } as Request;
    const res1 = makeMockRes();
    handler!(reqBase, res1);
    expect(res1.statusCode).toBe(404);
    expect(res1.body).toEqual({ error: "request not found" });

    const res2 = makeMockRes();
    handler!(reqBase, res2);
    expect(res2.statusCode).toBe(200);
    expect(res2.body).toEqual({ ok: true, requestId: "r1", status: "canceled", idempotent: true });

    const res3 = makeMockRes();
    handler!(reqBase, res3);
    expect(res3.statusCode).toBe(200);
    expect(res3.body).toEqual({ ok: true, requestId: "r2", status: "canceled" });
  });
});
