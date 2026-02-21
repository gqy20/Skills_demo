import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import PendingOverlay from "../../../src/webapp/components/PendingOverlay.jsx";

describe("PendingOverlay", () => {
  it("renders hidden state", () => {
    const html = renderToStaticMarkup(
      React.createElement(PendingOverlay, {
        blockingPending: false,
        activePending: null,
        askQuestions: [],
        draft: { index: 0, answers: {} },
        currentAsk: null,
        setAskDraft: vi.fn(),
        submitPending: vi.fn(async () => {}),
        cancelPending: vi.fn(async () => {})
      })
    );
    expect(html).toContain("pending-overlay hidden");
  });

  it("renders permission request actions", () => {
    const html = renderToStaticMarkup(
      React.createElement(PendingOverlay, {
        blockingPending: true,
        activePending: { kind: "permission_request", requestId: "r1", input: { a: 1 } },
        askQuestions: [],
        draft: { index: 0, answers: {} },
        currentAsk: null,
        setAskDraft: vi.fn(),
        submitPending: vi.fn(async () => {}),
        cancelPending: vi.fn(async () => {})
      })
    );
    expect(html).toContain("Tool Permission");
    expect(html).toContain("允许");
    expect(html).toContain("拒绝");
  });
});
