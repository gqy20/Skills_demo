import { describe, expect, it, vi } from "vitest";
import { handleChatStreamPart } from "../../../src/webapp/lib/chatStreamHandlers.js";

describe("handleChatStreamPart", () => {
  it("handles data-session", () => {
    const setCurrentSessionId = vi.fn();
    const result = handleChatStreamPart(
      { type: "data-session", data: { sessionId: "s1" } },
      {
        setEvents: vi.fn(),
        setCurrentSessionId,
        setActiveTurnTrace: vi.fn(),
        loadSessions: vi.fn(),
        setMcpRuntimeStatus: vi.fn(),
        setExecutionState: vi.fn(),
        trackMcpUsage: vi.fn(),
        setDiagnostics: vi.fn(),
        upsertPending: vi.fn(),
        resolvePending: vi.fn(),
        trackSkillUsage: vi.fn(),
        toolLabel: vi.fn(() => ""),
        shortText: (v) => String(v || ""),
        now: 1
      }
    );
    expect(setCurrentSessionId).toHaveBeenCalledTimes(1);
    const updater = setCurrentSessionId.mock.calls[0][0];
    expect(typeof updater).toBe("function");
    expect(updater("old")).toBe("s1");
    expect(updater("s1")).toBe("s1");
    expect(result).toBe("handled");
  });

  it("handles finish and triggers loadSessions", () => {
    const loadSessions = vi.fn(() => Promise.resolve());
    const setActiveTurnTrace = vi.fn();
    const result = handleChatStreamPart(
      { type: "finish" },
      {
        setEvents: vi.fn(),
        setCurrentSessionId: vi.fn(),
        setActiveTurnTrace,
        loadSessions,
        setMcpRuntimeStatus: vi.fn(),
        setExecutionState: vi.fn(),
        trackMcpUsage: vi.fn(),
        setDiagnostics: vi.fn(),
        upsertPending: vi.fn(),
        resolvePending: vi.fn(),
        trackSkillUsage: vi.fn(),
        toolLabel: vi.fn(() => ""),
        shortText: (v) => String(v || ""),
        now: 2
      }
    );
    expect(setActiveTurnTrace).toHaveBeenCalled();
    expect(loadSessions).toHaveBeenCalled();
    expect(result).toBe("handled");
  });

  it("appends hook stage timeline event", () => {
    const setHookTimeline = vi.fn();
    const result = handleChatStreamPart(
      { type: "data-hook-stage", data: { stage: "hook_started", hookName: "update-status.sh", at: 123 } },
      {
        setEvents: vi.fn(),
        setCurrentSessionId: vi.fn(),
        setActiveTurnTrace: vi.fn(),
        loadSessions: vi.fn(),
        setMcpRuntimeStatus: vi.fn(),
        setExecutionState: vi.fn(),
        trackMcpUsage: vi.fn(),
        setDiagnostics: vi.fn(),
        upsertPending: vi.fn(),
        resolvePending: vi.fn(),
        trackSkillUsage: vi.fn(),
        toolLabel: vi.fn(() => ""),
        shortText: (v) => String(v || ""),
        setHookTimeline,
        now: 3
      }
    );
    expect(setHookTimeline).toHaveBeenCalled();
    expect(result).toBe("handled");
  });

  it("handles first token timeout event", () => {
    const setExecutionState = vi.fn();
    const result = handleChatStreamPart(
      { type: "data-first-token-timeout", data: { waitedSeconds: 21 } },
      {
        setEvents: vi.fn(),
        setCurrentSessionId: vi.fn(),
        setActiveTurnTrace: vi.fn(),
        loadSessions: vi.fn(),
        setMcpRuntimeStatus: vi.fn(),
        setExecutionState,
        trackMcpUsage: vi.fn(),
        setDiagnostics: vi.fn(),
        upsertPending: vi.fn(),
        resolvePending: vi.fn(),
        trackSkillUsage: vi.fn(),
        toolLabel: vi.fn(() => ""),
        shortText: (v) => String(v || ""),
        setHookTimeline: vi.fn(),
        now: 3
      }
    );
    expect(setExecutionState).toHaveBeenCalled();
    expect(result).toBe("handled");
  });

  it("refreshes mcp catalog on mcp status event", () => {
    const loadMcps = vi.fn(() => Promise.resolve());
    const setMcpRuntimeStatus = vi.fn();
    const result = handleChatStreamPart(
      { type: "data-mcp-status", data: { ok: true, count: 3 } },
      {
        setEvents: vi.fn(),
        setCurrentSessionId: vi.fn(),
        setActiveTurnTrace: vi.fn(),
        loadSessions: vi.fn(),
        loadMcps,
        setMcpRuntimeStatus,
        setExecutionState: vi.fn(),
        trackMcpUsage: vi.fn(),
        setDiagnostics: vi.fn(),
        upsertPending: vi.fn(),
        resolvePending: vi.fn(),
        trackSkillUsage: vi.fn(),
        toolLabel: vi.fn(() => ""),
        shortText: (v) => String(v || ""),
        now: 1
      }
    );
    expect(setMcpRuntimeStatus).toHaveBeenCalled();
    expect(loadMcps).toHaveBeenCalled();
    expect(result).toBe("handled");
  });
});
