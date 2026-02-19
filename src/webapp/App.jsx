import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Composer from "./components/Composer.jsx";
import FileEditorPane from "./components/FileEditorPane.jsx";
import InspectorSidebar from "./components/InspectorSidebar.jsx";

const MAX_EVENT_LOG = 120;
const QUICK_PROMPTS = [
  { title: "文献综述分析", text: "请基于当前文献目录，提取研究问题、方法、结论并给出研究空白。" },
  { title: "科研初稿生成", text: "请根据已有文献与项目背景，生成研究报告初稿（摘要、方法、实验设计、讨论）。" }
];
const QUICK_CHIPS = [
  "先分析文献目录结构",
  "列出研究空白与创新点",
  "基于已有资料生成初稿大纲"
];

function createId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function textFromMessage(message) {
  if (!Array.isArray(message?.parts)) return "";
  return message.parts
    .filter((part) => part?.type === "text" && typeof part?.text === "string")
    .map((part) => part.text)
    .join("");
}

function parseError(error) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    if (typeof error.error === "string") return error.error;
    if (typeof error.message === "string") return error.message;
  }
  return String(error);
}

function shortText(value, max = 120) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function permissionProfileLabel(mode) {
  if (mode === "full_auto") return "全部允许";
  if (mode === "accept_edits") return "自动接受编辑";
  return "标准";
}

function formatElapsed(seconds) {
  const n = Math.max(0, Math.floor(seconds));
  if (n < 60) return `${n}s`;
  const m = Math.floor(n / 60);
  const s = n % 60;
  return `${m}m ${s}s`;
}

function extractSlashCommand(text) {
  const m = String(text || "").trim().match(/^\/([a-zA-Z0-9_-]+)/);
  return m ? m[1].toLowerCase() : "";
}

function flattenFiles(items, level = 0) {
  if (!Array.isArray(items)) return [];
  const out = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    out.push({ ...item, level });
    if (item.type === "directory" && Array.isArray(item.children) && item.children.length > 0) {
      out.push(...flattenFiles(item.children, level + 1));
    }
  }
  return out;
}

function parseMcpToolName(rawName) {
  const name = String(rawName || "").trim();
  if (!name) return null;
  if (name.startsWith("mcp__")) {
    const parts = name.split("__").filter(Boolean);
    if (parts.length >= 3) return { server: parts[1], tool: parts.slice(2).join("__"), raw: name };
    return { server: "unknown", tool: name, raw: name };
  }
  if (name.startsWith("mcp:")) {
    const parts = name.split(":");
    if (parts.length >= 3) return { server: parts[1] || "unknown", tool: parts.slice(2).join(":"), raw: name };
    return { server: "unknown", tool: name, raw: name };
  }
  return null;
}

function toolLabel(rawName) {
  const parsed = parseMcpToolName(rawName);
  if (parsed) return `${parsed.server}.${parsed.tool}`;
  return String(rawName || "").trim() || "unknown_tool";
}

function formatPhaseLabel(phase) {
  const map = {
    queued: "已入队",
    waiting_user_input: "等待用户输入",
    waiting_permission: "等待权限确认",
    tool_running: "工具执行中",
    tool_summary: "工具结果汇总",
    responding: "生成回复中",
    completed: "已完成"
  };
  return map[String(phase || "")] || String(phase || "");
}

function looksLikeToolClaim(text) {
  const t = String(text || "");
  if (!t) return false;
  return /(mcp__|mcp|search_literature|get_article_details|tool|工具|调用|检索|读取|保存到文件|skills?)/i.test(t);
}

function normalizeSettings(data) {
  return {
    model: data?.model || "",
    baseUrl: data?.baseUrl || "",
    authToken: "",
    hasToken: data?.hasToken === true,
    tokenPreview: data?.tokenPreview || "",
    mineruApiKey: "",
    hasMineruKey: data?.hasMineruKey === true,
    mineruKeyPreview: data?.mineruKeyPreview || "",
    permissionProfile:
      data?.permissionProfile === "full_auto" || data?.permissionProfile === "accept_edits"
        ? data.permissionProfile
        : "standard",
    mcpEnabled: data?.mcpEnabled !== false,
    speedModeEnabled: data?.speedModeEnabled === true,
    toolGateEnabled: data?.toolGateEnabled !== false,
    debugEnabled: data?.debugEnabled === true,
    debugSseEnabled: data?.debugSseEnabled === true
  };
}

export default function App() {
  const [workspaces, setWorkspaces] = useState([]);
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState("");
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [settings, setSettings] = useState({
    model: "",
    baseUrl: "",
    authToken: "",
    hasToken: false,
    tokenPreview: "",
    mineruApiKey: "",
    hasMineruKey: false,
    mineruKeyPreview: "",
    permissionProfile: "standard",
    mcpEnabled: true,
    speedModeEnabled: false,
    toolGateEnabled: true,
    debugEnabled: false,
    debugSseEnabled: false
  });
  const [events, setEvents] = useState([]);
  const [runtimeUsage, setRuntimeUsage] = useState({ skills: {}, mcps: {} });
  const [usagePanelOpen, setUsagePanelOpen] = useState(false);
  const [usageExpanded, setUsageExpanded] = useState({ skills: false, mcps: false });
  const [skills, setSkills] = useState([]);
  const [files, setFiles] = useState([]);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dangerConfirmText, setDangerConfirmText] = useState("");
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState("");
  const [openingSessionId, setOpeningSessionId] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarSections, setSidebarSections] = useState({
    mcps: true,
    sessions: true,
    files: false,
    pending: false,
    events: false
  });
  const [skillExpanded, setSkillExpanded] = useState({});
  const [skillFilter, setSkillFilter] = useState("");
  const [skillSourceTab, setSkillSourceTab] = useState("all");
  const [fileFilter, setFileFilter] = useState("");
  const [openedFile, setOpenedFile] = useState(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileSaving, setFileSaving] = useState(false);
  const [fileError, setFileError] = useState("");
  const [inputText, setInputText] = useState("");
  const [lastUserText, setLastUserText] = useState("");
  const [pendingState, setPendingState] = useState({
    byId: {},
    order: [],
    activeId: null,
    drafts: {}
  });
  const [diagnostics, setDiagnostics] = useState({
    toolGateEnabled: true,
    gateHits: 0,
    askCreated: 0,
    askResolved: 0
  });
  const [executionState, setExecutionState] = useState({
    phase: "idle",
    currentTool: "",
    toolElapsedSeconds: 0,
    lastDeltaAt: 0,
    actions: [],
    dismissNoDelta: false
  });
  const [mcpRuntimeStatus, setMcpRuntimeStatus] = useState({
    ok: null,
    count: 0,
    error: ""
  });
  const [mcpCatalog, setMcpCatalog] = useState({
    loading: false,
    error: "",
    mcpEnabled: true,
    runtime: { ok: null, error: "", source: "", checking: false, lastCheckedAt: null, ageSeconds: null, stale: true },
    items: [],
    updatedAt: 0
  });
  const [activeTurnTrace, setActiveTurnTrace] = useState(null);
  const [traceByAssistantId, setTraceByAssistantId] = useState({});
  const [nowTick, setNowTick] = useState(Date.now());
  const controlsRef = useRef(null);
  const textareaRef = useRef(null);
  const timelineRef = useRef(null);

  const trackSkillUsage = useCallback((skillName, details = null) => {
    const name = String(skillName || "").trim().toLowerCase();
    if (!name) return;
    setRuntimeUsage((prev) => {
      const old = prev.skills[name] || { count: 0, lastTs: 0, details: null };
      return {
        ...prev,
        skills: {
          ...prev.skills,
          [name]: { count: old.count + 1, lastTs: Date.now(), details: details || old.details || null }
        }
      };
    });
  }, []);

  const trackMcpUsage = useCallback((toolName, elapsedSeconds = null) => {
    const parsed = parseMcpToolName(toolName);
    if (!parsed) return false;
    const key = `${parsed.server}:${parsed.tool}`;
    setRuntimeUsage((prev) => {
      const old = prev.mcps[key] || { count: 0, lastTs: 0, details: null };
      return {
        ...prev,
        mcps: {
          ...prev.mcps,
          [key]: {
            count: old.count + 1,
            lastTs: Date.now(),
            details: { server: parsed.server, tool: parsed.tool, raw: parsed.raw, elapsedSeconds }
          }
        }
      };
    });
    return true;
  }, []);

  const workspaceQuery = useCallback(
    (pathname) => {
      if (!currentWorkspaceId) return pathname;
      const sep = pathname.includes("?") ? "&" : "?";
      return `${pathname}${sep}workspaceId=${encodeURIComponent(currentWorkspaceId)}`;
    },
    [currentWorkspaceId]
  );

  const apiGetJson = useCallback(
    async (pathname, params = null) => {
      const url = new URL(workspaceQuery(pathname), window.location.origin);
      if (params && typeof params === "object") {
        Object.entries(params).forEach(([k, v]) => {
          if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
        });
      }
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    [workspaceQuery]
  );

  const apiPostJson = useCallback(
    async (pathname, body) => {
      const res = await fetch(workspaceQuery(pathname), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {})
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    [workspaceQuery]
  );

  const apiPutJson = useCallback(
    async (pathname, body) => {
      const res = await fetch(workspaceQuery(pathname), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {})
      });
      const text = await res.text();
      let parsed = {};
      try {
        parsed = text ? JSON.parse(text) : {};
      } catch {
        parsed = { error: text || "request failed" };
      }
      if (!res.ok) throw parsed;
      return parsed;
    },
    [workspaceQuery]
  );

  const upsertPending = useCallback((kind, data) => {
    const requestId = data?.requestId;
    if (!requestId) return;
    setPendingState((prev) => {
      const old = prev.byId[requestId] || {};
      const nextItem = {
        ...old,
        requestId,
        kind,
        toolName: data?.toolName || old.toolName || "",
        input: data?.input || old.input || {},
        suggestions: data?.suggestions || old.suggestions || [],
        status: "pending"
      };
      return {
        ...prev,
        byId: { ...prev.byId, [requestId]: nextItem },
        order: prev.order.includes(requestId) ? prev.order : [...prev.order, requestId],
        activeId: prev.activeId || requestId
      };
    });
  }, []);

  const resolvePending = useCallback((data) => {
    const requestId = data?.requestId;
    if (!requestId) return;
    setPendingState((prev) => {
      if (!prev.byId[requestId]) return prev;
      const nextById = { ...prev.byId };
      delete nextById[requestId];
      const nextOrder = prev.order.filter((id) => id !== requestId);
      return {
        ...prev,
        byId: nextById,
        order: nextOrder,
        activeId: nextOrder[0] || null
      };
    });
  }, []);

  const activePending = pendingState.activeId ? pendingState.byId[pendingState.activeId] : null;

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat/ui",
        prepareSendMessagesRequest: ({ messages }) => ({
          body: {
            id: currentSessionId || undefined,
            workspaceId: currentWorkspaceId || undefined,
            messages
          }
        })
      }),
    [currentSessionId, currentWorkspaceId]
  );

  const { messages, setMessages, sendMessage, status, stop } = useChat({
    transport,
    onData: (part) => {
      setEvents((prev) => [...prev.slice(-(MAX_EVENT_LOG - 1)), part]);
      const now = Date.now();

      if (part?.type === "data-session" && part?.data?.sessionId) {
        setCurrentSessionId(part.data.sessionId);
        return;
      }

      if (part?.type === "finish") {
        setActiveTurnTrace((prev) =>
          prev
            ? {
                ...prev,
                completedAt: Date.now(),
                phases: [...(prev.phases || []), { phase: "completed", at: Date.now() }].slice(-30)
              }
            : prev
        );
        loadSessions().catch(() => {});
        return;
      }

      if (part?.type === "data-mcp-status") {
        setMcpRuntimeStatus({
          ok: part?.data?.ok === true,
          count: Number(part?.data?.count || 0),
          error: String(part?.data?.error || "")
        });
        return;
      }

      if (part?.type === "text-delta") {
        setActiveTurnTrace((prev) => {
          if (!prev || prev.responseStarted) return prev;
          return {
            ...prev,
            responseStarted: true,
            phases: [...(prev.phases || []), { phase: "responding", at: now }].slice(-30)
          };
        });
        setExecutionState((prev) => ({
          ...prev,
          phase: "responding",
          lastDeltaAt: now,
          dismissNoDelta: false
        }));
        return;
      }

      if (part?.type === "data-tool-progress") {
        trackMcpUsage(part?.data?.toolName, part?.data?.elapsedSeconds ?? null);
        setActiveTurnTrace((prev) => {
          if (!prev) return prev;
          const label = toolLabel(part?.data?.toolName);
          const useId = String(part?.data?.toolUseId || "");
          const seen = { ...(prev.seenToolUseIds || {}) };
          const tools = { ...(prev.tools || {}) };
          const old = tools[label] || { count: 0, elapsedSeconds: 0 };
          const isNewUse = useId ? seen[useId] !== true : old.count === 0;
          if (useId) seen[useId] = true;
          tools[label] = {
            count: isNewUse ? old.count + 1 : old.count,
            elapsedSeconds: Math.max(old.elapsedSeconds || 0, Number(part?.data?.elapsedSeconds || 0))
          };
          const phases =
            prev.lastToolLabel === label
              ? prev.phases || []
              : [...(prev.phases || []), { phase: "tool_running", at: now, detail: label }].slice(-30);
          return { ...prev, seenToolUseIds: seen, tools, lastToolLabel: label, phases };
        });
        setExecutionState((prev) => ({
          ...prev,
          phase: "tool",
          currentTool: String(part?.data?.toolName || prev.currentTool || ""),
          toolElapsedSeconds:
            typeof part?.data?.elapsedSeconds === "number" && Number.isFinite(part?.data?.elapsedSeconds)
              ? Math.max(0, part.data.elapsedSeconds)
              : prev.toolElapsedSeconds,
          dismissNoDelta: false
        }));
        return;
      }

      if (part?.type === "data-tool-use-summary") {
        const summary = String(part?.data?.summary || "");
        const matched = summary.match(/\/([a-zA-Z0-9_-]+)/g) || [];
        for (const token of matched) {
          trackSkillUsage(token.replace("/", ""), { source: "summary", summary: shortText(summary, 280) });
        }
        setActiveTurnTrace((prev) => {
          if (!prev) return prev;
          const nextAction = shortText(summary, 220);
          const skills = { ...(prev.skills || {}) };
          for (const token of matched) {
            const name = token.replace("/", "").trim().toLowerCase();
            if (!name) continue;
            const old = skills[name] || { count: 0 };
            skills[name] = { count: old.count + 1 };
          }
          return {
            ...prev,
            skills,
            actions: [...(prev.actions || []).slice(-5), nextAction],
            phases: [...(prev.phases || []), { phase: "tool_summary", at: now }].slice(-30)
          };
        });
        setExecutionState((prev) => ({
          ...prev,
          phase: "tool",
          actions: [...prev.actions.slice(-4), shortText(summary, 220)],
          dismissNoDelta: false
        }));
        return;
      }

      if (part?.type === "data-tool-gate-status") {
        setDiagnostics((prev) => ({
          ...prev,
          toolGateEnabled: part?.data?.enabled !== false
        }));
        return;
      }

      if (part?.type === "data-tool-gate-hit") {
        trackMcpUsage(part?.data?.toolName, null);
        setActiveTurnTrace((prev) => {
          if (!prev) return prev;
          const label = toolLabel(part?.data?.toolName);
          const tools = { ...(prev.tools || {}) };
          const old = tools[label] || { count: 0, elapsedSeconds: 0 };
          tools[label] = { ...old, count: old.count + 1 };
          return { ...prev, tools };
        });
        setDiagnostics((prev) => ({
          ...prev,
          gateHits: prev.gateHits + 1
        }));
        return;
      }

      if (part?.type === "data-ask-user-question-created") {
        setDiagnostics((prev) => ({ ...prev, askCreated: prev.askCreated + 1 }));
        upsertPending("ask_user_question", part.data || {});
        setExecutionState((prev) => ({
          ...prev,
          phase: "pending",
          dismissNoDelta: false
        }));
        setActiveTurnTrace((prev) =>
          prev
            ? { ...prev, phases: [...(prev.phases || []), { phase: "waiting_user_input", at: now }].slice(-30) }
            : prev
        );
        return;
      }

      if (part?.type === "data-permission-request-created") {
        trackMcpUsage(part?.data?.toolName, null);
        setActiveTurnTrace((prev) => {
          if (!prev) return prev;
          const label = toolLabel(part?.data?.toolName);
          const tools = { ...(prev.tools || {}) };
          const old = tools[label] || { count: 0, elapsedSeconds: 0 };
          tools[label] = { ...old, count: old.count + 1 };
          return { ...prev, tools };
        });
        upsertPending("permission_request", part.data || {});
        setExecutionState((prev) => ({
          ...prev,
          phase: "pending",
          currentTool: String(part?.data?.toolName || prev.currentTool || ""),
          dismissNoDelta: false
        }));
        setActiveTurnTrace((prev) =>
          prev
            ? {
                ...prev,
                phases: [
                  ...(prev.phases || []),
                  { phase: "waiting_permission", at: now, detail: toolLabel(part?.data?.toolName) }
                ].slice(-30)
              }
            : prev
        );
        return;
      }

      if (
        part?.type === "data-ask-user-question-resolved" ||
        part?.type === "data-ask-user-question-timeout" ||
        part?.type === "data-ask-user-question-canceled"
      ) {
        setDiagnostics((prev) => ({ ...prev, askResolved: prev.askResolved + 1 }));
        resolvePending(part.data || {});
        return;
      }

      if (
        part?.type === "data-permission-request-resolved" ||
        part?.type === "data-permission-request-timeout" ||
        part?.type === "data-permission-request-canceled"
      ) {
        resolvePending(part.data || {});
      }
    },
    onError: (error) => {
      setEvents((prev) => [...prev.slice(-(MAX_EVENT_LOG - 1)), { type: "error", error: parseError(error) }]);
    }
  });

  const isStreaming = status === "submitted" || status === "streaming";
  const blockingPending = Boolean(activePending);
  const lastAssistantId = useMemo(
    () =>
      messages
        .slice()
        .reverse()
        .find((item) => item.role === "assistant")?.id || "",
    [messages]
  );
  const showPreflight = messages.length === 0 && !isStreaming && !lastUserText;
  const silentSeconds =
    isStreaming && executionState.lastDeltaAt > 0 ? Math.floor((nowTick - executionState.lastDeltaAt) / 1000) : 0;
  const showNoDeltaHint =
    isStreaming &&
    silentSeconds >= 10 &&
    executionState.phase !== "responding" &&
    !executionState.dismissNoDelta &&
    !blockingPending;
  const showExecutionPanel = isStreaming || blockingPending;

  useEffect(() => {
    if (!lastAssistantId || !activeTurnTrace?.completedAt) return;
    setTraceByAssistantId((prev) => {
      if (prev[lastAssistantId]) return prev;
      return { ...prev, [lastAssistantId]: activeTurnTrace };
    });
    setActiveTurnTrace(null);
  }, [activeTurnTrace, lastAssistantId]);

  const loadWorkspaces = useCallback(async () => {
    const data = await apiGetJson("/api/workspaces", { workspaceId: "" });
    const items = Array.isArray(data.items) ? data.items : [];
    setWorkspaces(items);
    setCurrentWorkspaceId((prev) => prev || data.currentWorkspaceId || items[0]?.id || "");
  }, [apiGetJson]);

  const loadSettings = useCallback(async () => {
    if (!currentWorkspaceId) return;
    const data = await apiGetJson("/api/settings");
    setSettings(normalizeSettings(data));
    setDiagnostics((prev) => ({ ...prev, toolGateEnabled: data.toolGateEnabled !== false }));
  }, [apiGetJson, currentWorkspaceId]);

  const loadSkills = useCallback(async () => {
    if (!currentWorkspaceId) return;
    const data = await apiGetJson("/api/skills");
    setSkills(Array.isArray(data.items) ? data.items : []);
  }, [apiGetJson, currentWorkspaceId]);

  const loadFiles = useCallback(async () => {
    if (!currentWorkspaceId) return;
    const data = await apiGetJson("/api/files", { depth: 2, path: "" });
    setFiles(Array.isArray(data.items) ? data.items : []);
  }, [apiGetJson, currentWorkspaceId]);

  const loadMcps = useCallback(async () => {
    if (!currentWorkspaceId) return;
    setMcpCatalog((prev) => ({ ...prev, loading: true, error: "" }));
    try {
      const data = await apiGetJson("/api/mcps");
      setMcpCatalog({
        loading: false,
        error: "",
        mcpEnabled: data?.mcpEnabled !== false,
        runtime: {
          ok: typeof data?.runtime?.ok === "boolean" ? data.runtime.ok : null,
          error: String(data?.runtime?.error || ""),
          source: String(data?.runtime?.source || ""),
          checking: data?.runtime?.checking === true,
          lastCheckedAt: typeof data?.runtime?.lastCheckedAt === "number" ? data.runtime.lastCheckedAt : null,
          ageSeconds: typeof data?.runtime?.ageSeconds === "number" ? data.runtime.ageSeconds : null,
          stale: data?.runtime?.stale !== false
        },
        items: Array.isArray(data?.items) ? data.items : [],
        updatedAt: Date.now()
      });
    } catch (error) {
      setMcpCatalog((prev) => ({
        ...prev,
        loading: false,
        error: parseError(error),
        updatedAt: Date.now()
      }));
    }
  }, [apiGetJson, currentWorkspaceId]);

  const refreshMcps = useCallback(async () => {
    if (!currentWorkspaceId) return;
    setMcpCatalog((prev) => ({ ...prev, loading: true, error: "" }));
    try {
      await apiPostJson("/api/mcps/refresh", {});
    } catch (error) {
      setMcpCatalog((prev) => ({ ...prev, loading: false, error: parseError(error), updatedAt: Date.now() }));
      return;
    }
    const delays = [0, 400, 1200, 2600];
    for (let i = 0; i < delays.length; i += 1) {
      if (delays[i] > 0) await new Promise((resolve) => setTimeout(resolve, delays[i]));
      await loadMcps();
    }
  }, [apiPostJson, currentWorkspaceId, loadMcps]);

  const openFile = useCallback(
    async (filePath) => {
      const nextPath = String(filePath || "").trim();
      if (!nextPath || !currentWorkspaceId) return;
      setFileLoading(true);
      setFileError("");
      try {
        const data = await apiGetJson("/api/file", { path: nextPath });
        const content = typeof data?.content === "string" ? data.content : "";
        const pathValue = typeof data?.path === "string" ? data.path : nextPath;
        setOpenedFile({
          path: pathValue,
          name: data?.name || pathValue.split("/").pop() || pathValue,
          content,
          savedContent: content,
          mtimeMs: Number(data?.mtimeMs || 0),
          size: Number(data?.size || 0),
          dirty: false
        });
      } catch (error) {
        setFileError(parseError(error));
      } finally {
        setFileLoading(false);
      }
    },
    [apiGetJson, currentWorkspaceId]
  );

  const requestOpenFile = useCallback(
    async (filePath, { force = false } = {}) => {
      const nextPath = String(filePath || "").trim();
      if (!nextPath) return;
      if (openedFile?.path === nextPath && !fileLoading) return;
      if (!force && openedFile?.dirty) {
        const ok = window.confirm("当前文件有未保存修改，是否放弃并切换到其他文件？");
        if (!ok) return;
      }
      await openFile(nextPath);
    },
    [fileLoading, openFile, openedFile?.dirty, openedFile?.path]
  );

  const saveOpenedFile = useCallback(async () => {
    if (!openedFile?.path || fileLoading || fileSaving) return;
    if (!openedFile.dirty) return;
    setFileSaving(true);
    setFileError("");
    try {
      const data = await apiPutJson("/api/file", {
        path: openedFile.path,
        content: openedFile.content,
        expectedMtimeMs: openedFile.mtimeMs
      });
      const mtimeMs = Number(data?.mtimeMs || Date.now());
      setOpenedFile((prev) =>
        prev
          ? {
              ...prev,
              savedContent: prev.content,
              dirty: false,
              mtimeMs,
              size: Number(data?.size || prev.size || 0)
            }
          : prev
      );
      loadFiles().catch(() => {});
    } catch (error) {
      setFileError(parseError(error));
    } finally {
      setFileSaving(false);
    }
  }, [apiPutJson, fileLoading, fileSaving, loadFiles, openedFile]);

  const loadSessions = useCallback(async () => {
    if (!currentWorkspaceId) return;
    setSessionsLoading(true);
    setSessionsError("");
    try {
      const data = await apiGetJson("/api/sessions");
      setSessions(Array.isArray(data.items) ? data.items : []);
    } catch (error) {
      setSessionsError(parseError(error));
    } finally {
      setSessionsLoading(false);
    }
  }, [apiGetJson, currentWorkspaceId]);

  const loadFileSuggestions = useCallback(
    async (rawQuery) => {
      if (!currentWorkspaceId) return [];
      const query = String(rawQuery || "")
        .trim()
        .replaceAll("\\", "/")
        .replace(/^\/+/, "");
      const slash = query.lastIndexOf("/");
      const basePath = slash >= 0 ? query.slice(0, slash + 1).replace(/\/+$/, "") : "";
      const depth = basePath ? 2 : 3;
      const data = await apiGetJson("/api/files", { path: basePath, depth });
      return Array.isArray(data?.items) ? data.items : [];
    },
    [apiGetJson, currentWorkspaceId]
  );

  useEffect(() => {
    loadWorkspaces().catch(() => {});
  }, [loadWorkspaces]);

  useEffect(() => {
    loadSettings().catch(() => {});
    loadSkills().catch(() => {});
    loadMcps().catch(() => {});
    loadFiles().catch(() => {});
    loadSessions().catch(() => {});
  }, [currentWorkspaceId, loadFiles, loadMcps, loadSettings, loadSkills, loadSessions]);

  useEffect(() => {
    setOpenedFile(null);
    setFileLoading(false);
    setFileSaving(false);
    setFileError("");
  }, [currentWorkspaceId]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.hidden) return;
      loadSkills().catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [loadSkills]);

  useEffect(() => {
    const onDocClick = (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (controlsRef.current && controlsRef.current.contains(target)) return;
      setControlsOpen(false);
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  useEffect(() => {
    const el = timelineRef.current;
    if (!el) return;
    const raf = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(raf);
  }, [messages, isStreaming, blockingPending]);

  useEffect(() => {
    if (!isStreaming && !blockingPending) return;
    const timer = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [isStreaming, blockingPending]);

  const saveSettings = useCallback(
    async (next) => {
      const data = await apiPostJson("/api/settings", {
        ...next,
        keepExistingToken: next.authToken ? false : true,
        keepExistingMineruKey: next.mineruApiKey ? false : true
      });
      setSettings(normalizeSettings(data));
      setCurrentSessionId(null);
      setDiagnostics((prev) => ({ ...prev, toolGateEnabled: data.toolGateEnabled !== false }));
      return data;
    },
    [apiPostJson]
  );

  const submitUserMessage = async (overrideText = null) => {
    const text = (overrideText ?? inputText).trim();
    if (!text || isStreaming || blockingPending) return;
    const initialSkill = extractSlashCommand(text);
    const initialSkillsState = initialSkill
      ? { [initialSkill]: { count: 1, lastTs: Date.now(), details: { source: "prompt", text: shortText(text, 220) } } }
      : {};
    setLastUserText(text);
    setInputText("");
    setEvents([]);
    setPendingState({ byId: {}, order: [], activeId: null, drafts: {} });
    setDiagnostics((prev) => ({
      ...prev,
      gateHits: 0,
      askCreated: 0,
      askResolved: 0
    }));
    setUsagePanelOpen(false);
    setRuntimeUsage({ skills: initialSkillsState, mcps: {} });
    setUsageExpanded({ skills: false, mcps: false });
    setExecutionState({
      phase: "queued",
      currentTool: "",
      toolElapsedSeconds: 0,
      lastDeltaAt: Date.now(),
      actions: [],
      dismissNoDelta: false
    });
    setMcpRuntimeStatus({ ok: null, count: 0, error: "" });
    setActiveTurnTrace({
      startedAt: Date.now(),
      completedAt: 0,
      seenToolUseIds: {},
      responseStarted: false,
      lastToolLabel: "",
      skills: {},
      tools: {},
      phases: [{ phase: "queued", at: Date.now() }],
      actions: []
    });
    await sendMessage({ id: createId(), text });
  };

  const retryLast = () => submitUserMessage(lastUserText).catch(() => {});
  const copyText = async (text) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore clipboard failures in unsupported environments
    }
  };

  const openSession = async (sessionId) => {
    if (!sessionId || isStreaming || blockingPending) return;
    setOpeningSessionId(sessionId);
    try {
      const data = await apiGetJson(`/api/sessions/${encodeURIComponent(sessionId)}`);
      const nextMessages = Array.isArray(data?.messages) ? data.messages : [];
      setMessages(nextMessages);
      const loadedTraceMap = {};
      for (const msg of nextMessages) {
        if (msg?.role !== "assistant" || !msg?.id) continue;
        const trace = msg?.toolTrace;
        if (!trace || typeof trace !== "object") continue;
        loadedTraceMap[msg.id] = {
          startedAt: Number(trace.startedAt || 0),
          completedAt: Number(trace.completedAt || 0),
          skills: typeof trace.skills === "object" && trace.skills ? trace.skills : {},
          tools: typeof trace.tools === "object" && trace.tools ? trace.tools : {},
          phases: Array.isArray(trace.phases) ? trace.phases : [],
          actions: Array.isArray(trace.actions) ? trace.actions : []
        };
      }
      setTraceByAssistantId(loadedTraceMap);
      setCurrentSessionId(sessionId);
      setActiveTurnTrace(null);
      setPendingState({ byId: {}, order: [], activeId: null, drafts: {} });
      setEvents([]);
      setExecutionState({
        phase: "idle",
        currentTool: "",
        toolElapsedSeconds: 0,
        lastDeltaAt: 0,
        actions: [],
        dismissNoDelta: false
      });
      setMcpRuntimeStatus({ ok: null, count: 0, error: "" });
      for (let i = nextMessages.length - 1; i >= 0; i -= 1) {
        const msg = nextMessages[i];
        if (msg?.role !== "user" || !Array.isArray(msg?.parts)) continue;
        const txt = msg.parts
          .filter((p) => p?.type === "text")
          .map((p) => p.text || "")
          .join("")
          .trim();
        if (txt) {
          setLastUserText(txt);
          break;
        }
      }
    } finally {
      setOpeningSessionId("");
    }
  };

  const startNewSession = () => {
    if (isStreaming || blockingPending) return;
    setCurrentSessionId(null);
    setMessages([]);
    setEvents([]);
    setLastUserText("");
    setRuntimeUsage({ skills: {}, mcps: {} });
    setUsagePanelOpen(false);
    setUsageExpanded({ skills: false, mcps: false });
    setPendingState({ byId: {}, order: [], activeId: null, drafts: {} });
    setExecutionState({
      phase: "idle",
      currentTool: "",
      toolElapsedSeconds: 0,
      lastDeltaAt: 0,
      actions: [],
      dismissNoDelta: false
    });
    setMcpRuntimeStatus({ ok: null, count: 0, error: "" });
    setTraceByAssistantId({});
    setActiveTurnTrace(null);
  };

  const forceStopAndRetry = async () => {
    stop();
    if (lastUserText) {
      setTimeout(() => {
        submitUserMessage(lastUserText).catch(() => {});
      }, 220);
    }
  };

  const autoResizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    const next = Math.min(el.scrollHeight, 184);
    el.style.height = `${Math.max(next, 46)}px`;
  }, []);

  const submitPending = async (requestId, payload) => {
    await apiPostJson("/api/input", { requestId, ...payload });
    resolvePending({ requestId });
  };

  const cancelPending = async (requestId) => {
    await apiPostJson("/api/input/cancel", { requestId });
    resolvePending({ requestId });
  };

  const askQuestions = Array.isArray(activePending?.input?.questions) ? activePending.input.questions : [];
  const draft = activePending
    ? pendingState.drafts[activePending.requestId] || { index: 0, answers: {} }
    : { index: 0, answers: {} };
  const currentAsk = askQuestions[draft.index];

  const setAskDraft = (next) => {
    if (!activePending) return;
    setPendingState((prev) => ({
      ...prev,
      drafts: {
        ...prev.drafts,
        [activePending.requestId]: {
          index: Math.min(Math.max(next.index ?? 0, 0), Math.max(askQuestions.length - 1, 0)),
          answers: { ...(next.answers || {}) }
        }
      }
    }));
  };

  const skillUsageList = useMemo(
    () =>
      Object.entries(runtimeUsage.skills)
        .map(([name, item]) => ({ name, ...(item || {}) }))
        .sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0)),
    [runtimeUsage.skills]
  );

  const mcpUsageList = useMemo(
    () =>
      Object.entries(runtimeUsage.mcps)
        .map(([key, item]) => ({ key, ...(item || {}) }))
        .sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0)),
    [runtimeUsage.mcps]
  );

  const skillSourceCounts = useMemo(() => {
    const counts = { all: skills.length, project: 0, user: 0 };
    for (const item of skills) {
      const src = String(item?.source || "").toLowerCase();
      if (src === "project") counts.project += 1;
      if (src === "user") counts.user += 1;
    }
    return counts;
  }, [skills]);

  const filteredSkills = useMemo(() => {
    const q = skillFilter.trim().toLowerCase();
    return skills.filter((item) => {
      const src = String(item?.source || "").toLowerCase();
      if (skillSourceTab !== "all" && src !== skillSourceTab) return false;
      if (!q) return true;
      const text = `${item?.name || ""} ${item?.description || ""} ${item?.source || ""}`.toLowerCase();
      return text.includes(q);
    });
  }, [skills, skillFilter, skillSourceTab]);

  const flattenedFiles = useMemo(() => flattenFiles(files), [files]);

  const filteredFiles = useMemo(() => {
    const q = fileFilter.trim().toLowerCase();
    if (!q) return flattenedFiles;
    return flattenedFiles.filter((item) => `${item?.name || ""} ${item?.path || ""}`.toLowerCase().includes(q));
  }, [flattenedFiles, fileFilter]);

  useEffect(() => {
    autoResizeTextarea();
  }, [inputText, autoResizeTextarea]);

  const toggleSidebarSection = (key) =>
    setSidebarSections((prev) => ({
      ...prev,
      [key]: !prev[key]
    }));

  return (
    <>
      <main className={`workspace ${sidebarOpen ? "workspace-with-sidebar" : "workspace-chat-only"}`}>
        <section className="chat-shell">
          <header className="chat-head">
            <div className="chat-head-row">
              <h1>Agent Workspace</h1>
              <div className="head-actions" ref={controlsRef}>
                <button className="btn-secondary" type="button" onClick={() => setSidebarOpen((v) => !v)}>
                  {sidebarOpen ? "隐藏侧栏" : "侧栏"}
                </button>
                <button className="btn-secondary" type="button" onClick={() => setControlsOpen((v) => !v)}>
                  控制
                </button>
                <div className={`controls-popover ${controlsOpen ? "" : "hidden"}`}>
                  <button
                    className={`btn-secondary ${settings.hasToken ? "" : "is-off"}`}
                    type="button"
                    onClick={() => {
                      setControlsOpen(false);
                      setSettingsOpen(true);
                    }}
                  >
                    API Key: {settings.hasToken ? "已配置" : "未配置"}
                  </button>
                  <button
                    className={`btn-secondary ${settings.hasMineruKey ? "" : "is-off"}`}
                    type="button"
                    onClick={() => {
                      setControlsOpen(false);
                      setSettingsOpen(true);
                    }}
                  >
                    MinerU: {settings.hasMineruKey ? "已配置" : "未配置"}
                  </button>
                  <button
                    className={`btn-secondary ${settings.mcpEnabled ? "" : "is-off"}`}
                    type="button"
                    onClick={async () => {
                      await saveSettings({ ...settings, mcpEnabled: !settings.mcpEnabled });
                      setControlsOpen(false);
                    }}
                  >
                    MCP: {settings.mcpEnabled ? "ON" : "OFF"}
                  </button>
                  <button
                    className="btn-secondary"
                    type="button"
                    onClick={() => {
                      setControlsOpen(false);
                      setSettingsOpen(true);
                    }}
                  >
                    权限: {permissionProfileLabel(settings.permissionProfile)}
                  </button>
                </div>
              </div>
            </div>
            <div className="runtime-meta">
              <span className="meta-chip">Workspace: {currentWorkspaceId || "-"}</span>
              <span className="meta-chip">Model: {settings.model || "-"}</span>
              <span className="meta-chip">权限: {permissionProfileLabel(settings.permissionProfile)}</span>
            </div>
          </header>

          <section className="timeline-wrap">
            <section className="timeline" ref={timelineRef}>
              <div className="timeline-inner">
                {showPreflight && (
                  <section className="empty-state">
                    <div className="empty-state-intro">
                      <h2>开始你的科研任务</h2>
                      <p>先选择任务模板，或在底部输入框补充具体要求后发送。</p>
                    </div>
                    <div className="empty-actions">
                      {QUICK_PROMPTS.map((item) => (
                        <button
                          key={item.title}
                          type="button"
                          className="empty-action-card"
                          onClick={() => submitUserMessage(item.text).catch(() => {})}
                        >
                          <strong>{item.title}</strong>
                          <span>{item.text}</span>
                          <span className="empty-action-cta">立即开始</span>
                        </button>
                      ))}
                    </div>
                    <div className="quick-chip-list">
                      {QUICK_CHIPS.map((chip) => (
                        <button key={chip} type="button" className="quick-chip" onClick={() => setInputText(chip)}>
                          {chip}
                        </button>
                      ))}
                    </div>
                  </section>
                )}

                {(skillUsageList.length > 0 || mcpUsageList.length > 0) && (
                  <section className="usage-strip">
                    <div className="usage-strip-head">
                      <strong>运行摘要</strong>
                      <button type="button" className="activity-toggle" onClick={() => setUsagePanelOpen((v) => !v)}>
                        {usagePanelOpen ? "收起" : "展开"}
                      </button>
                    </div>
                    {usagePanelOpen && (
                      <div className="usage-grid">
                        <article className="usage-card">
                          <header>
                            <span>Skills</span>
                            <button
                              type="button"
                              className="activity-toggle"
                              onClick={() => setUsageExpanded((prev) => ({ ...prev, skills: !prev.skills }))}
                            >
                              {usageExpanded.skills ? "收起" : "展开"}
                            </button>
                          </header>
                          <ul>
                            {(usageExpanded.skills ? skillUsageList : skillUsageList.slice(0, 3)).map((item) => (
                              <li key={item.name}>
                                <span>/{item.name}</span>
                                <em>x{item.count || 1}</em>
                              </li>
                            ))}
                          </ul>
                        </article>
                        <article className="usage-card">
                          <header>
                            <span>MCP</span>
                            <button
                              type="button"
                              className="activity-toggle"
                              onClick={() => setUsageExpanded((prev) => ({ ...prev, mcps: !prev.mcps }))}
                            >
                              {usageExpanded.mcps ? "收起" : "展开"}
                            </button>
                          </header>
                          <ul>
                            {(usageExpanded.mcps ? mcpUsageList : mcpUsageList.slice(0, 3)).map((item) => (
                              <li key={item.key}>
                                <span>{item.details?.server || "mcp"}::{item.details?.tool || item.key}</span>
                                <em>x{item.count || 1}</em>
                              </li>
                            ))}
                          </ul>
                        </article>
                      </div>
                    )}
                  </section>
                )}

                {showExecutionPanel && (
                  <section className="exec-panel">
                    <div className="exec-head">
                      <strong>
                        {blockingPending
                          ? "等待授权"
                          : executionState.phase === "responding"
                            ? "正在整理回复"
                            : executionState.phase === "tool"
                              ? "工具执行中"
                              : "处理中"}
                      </strong>
                      {executionState.currentTool && <span className="exec-tool">{executionState.currentTool}</span>}
                    </div>
                    <div className="exec-meta">
                      {executionState.toolElapsedSeconds > 0 && <span>工具耗时 {formatElapsed(executionState.toolElapsedSeconds)}</span>}
                      {silentSeconds > 0 && isStreaming && <span>最近无文本增量 {formatElapsed(silentSeconds)}</span>}
                      {!blockingPending && settings.permissionProfile === "full_auto" && <span>权限模式：全部允许</span>}
                      {mcpRuntimeStatus.ok === true && <span>MCP 连接正常（{mcpRuntimeStatus.count}）</span>}
                      {mcpRuntimeStatus.ok === false && (
                        <span className="exec-meta-warning">MCP 异常：{mcpRuntimeStatus.error || "连接失败"}</span>
                      )}
                    </div>
                    {executionState.actions.length > 0 && (
                      <ul className="exec-actions">
                        {executionState.actions.slice(-3).map((item, idx) => (
                          <li key={`${item}-${idx}`}>{item}</li>
                        ))}
                      </ul>
                    )}
                    {showNoDeltaHint && (
                      <div className="exec-hint">
                        <span>暂无文本输出，正在等待工具返回结果...</span>
                        <div className="exec-hint-actions">
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => setExecutionState((prev) => ({ ...prev, dismissNoDelta: true }))}
                          >
                            继续等待
                          </button>
                          <button type="button" className="btn-secondary" onClick={forceStopAndRetry}>
                            停止并重试
                          </button>
                        </div>
                      </div>
                    )}
                  </section>
                )}

                {(() => {
                  return messages.map((msg) => {
                    const isLastAssistant = msg.role === "assistant" && lastAssistantId === msg.id;
                    const text = textFromMessage(msg);
                    const hasVisibleText = text.trim().length > 0;
                    const showProcessing = msg.role === "assistant" && isLastAssistant && isStreaming && !hasVisibleText;
                    const trace = msg.role === "assistant" ? traceByAssistantId[msg.id] || msg?.toolTrace || null : null;
                    const traceToolEntries = trace ? Object.entries(trace.tools || {}) : [];
                    const traceSkillEntries = trace ? Object.entries(trace.skills || {}) : [];
                    const tracePhaseList = Array.isArray(trace?.phases) ? trace.phases : [];
                    const unverifiedToolClaim =
                      msg.role === "assistant" && traceToolEntries.length === 0 && traceSkillEntries.length === 0 && looksLikeToolClaim(text);
                    if (msg.role === "assistant" && !showProcessing && !hasVisibleText) return null;
                    return (
                      <article
                        key={msg.id}
                        className={`bubble ${msg.role === "user" ? "bubble-user" : "bubble-assistant"} ${
                          isLastAssistant && isStreaming && !showProcessing ? "bubble-streaming" : ""
                        } ${showProcessing ? "bubble-processing" : ""}`}
                      >
                        {msg.role === "assistant" ? (
                          showProcessing ? (
                            <div className="processing-card">
                              <p className="processing-title">处理中</p>
                              <p className="processing-subtitle">正在整理结果，请稍候...</p>
                              <div className="processing-skeleton">
                                <span />
                                <span />
                                <span />
                              </div>
                            </div>
                          ) : (
                            <div className="assistant-content bubble-enter">
                              <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                components={{
                                  table: ({ node, ...props }) => (
                                    <div className="markdown-table-wrap">
                                      <table {...props} />
                                    </div>
                                  )
                                }}
                              >
                                {text}
                              </ReactMarkdown>
                              {(traceToolEntries.length > 0 || traceSkillEntries.length > 0 || tracePhaseList.length > 0) && (
                                <div className="bubble-trace">
                                  <p className="bubble-trace-title">本轮调用</p>
                                  {traceSkillEntries.length > 0 && (
                                    <ul>
                                      {traceSkillEntries.slice(0, 4).map(([name, item]) => (
                                        <li key={`skill-${name}`}>
                                          <span>/{name}</span>
                                          <em>x{item?.count || 1}</em>
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                  {traceToolEntries.length > 0 && (
                                    <ul>
                                      {traceToolEntries.slice(0, 5).map(([name, item]) => (
                                        <li key={`tool-${name}`}>
                                          <span>{name}</span>
                                          <em>
                                            x{item?.count || 1}
                                            {item?.elapsedSeconds > 0 ? ` · ${formatElapsed(item.elapsedSeconds)}` : ""}
                                          </em>
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                  {tracePhaseList.length > 0 && (
                                    <p className="bubble-trace-phase">
                                      阶段：{tracePhaseList.slice(-3).map((item) => formatPhaseLabel(item?.phase)).join(" -> ")}
                                    </p>
                                  )}
                                </div>
                              )}
                              {unverifiedToolClaim && (
                                <div className="bubble-trace-warning">未检测到真实工具事件，当前内容可能是模型自述结果。</div>
                              )}
                              {isLastAssistant && (
                                <div className="bubble-actions">
                                  <button
                                    type="button"
                                    className="bubble-action-btn"
                                    title="复制"
                                    aria-label="复制"
                                    onClick={() => copyText(text)}
                                  >
                                    ⧉
                                  </button>
                                  <button
                                    type="button"
                                    className="bubble-action-btn"
                                    title="重试"
                                    aria-label="重试"
                                    onClick={retryLast}
                                    disabled={!lastUserText || isStreaming}
                                  >
                                    ↻
                                  </button>
                                </div>
                              )}
                            </div>
                          )
                        ) : (
                          <p>{text}</p>
                        )}
                      </article>
                    );
                  });
                })()}
              </div>
            </section>
          </section>

          <FileEditorPane
            openedFile={openedFile}
            fileLoading={fileLoading}
            fileSaving={fileSaving}
            fileError={fileError}
            onChange={(value) =>
              setOpenedFile((prev) =>
                prev
                  ? {
                      ...prev,
                      content: value,
                      dirty: value !== prev.savedContent
                    }
                  : prev
              )
            }
            onSave={() => saveOpenedFile().catch(() => {})}
            onReload={() => requestOpenFile(openedFile?.path, { force: true }).catch(() => {})}
            onClose={() => setOpenedFile(null)}
          />

          <section id="pending-overlay" className={`pending-overlay ${blockingPending ? "" : "hidden"}`}>
            {blockingPending && (
              <>
                <p>
                  <strong>{activePending.kind === "ask_user_question" ? "AskUserQuestion" : "Tool Permission"}</strong>
                </p>
                <p className="pending-why">为了继续执行任务，需要你先确认本步骤输入。</p>
                {activePending.kind === "permission_request" ? (
                  <>
                    <pre className="output">{JSON.stringify(activePending.input || {}, null, 2)}</pre>
                    <div className="pending-actions">
                      <button
                        type="button"
                        onClick={() => submitPending(activePending.requestId, { behavior: "allow", alwaysAllow: false })}
                      >
                        允许
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => submitPending(activePending.requestId, { behavior: "deny", message: "User denied from web UI." })}
                      >
                        拒绝
                      </button>
                      <button type="button" className="btn-secondary" onClick={() => cancelPending(activePending.requestId)}>
                        取消
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <fieldset className="pending-fieldset">
                      <legend>
                        问题 {draft.index + 1}/{askQuestions.length}
                      </legend>
                      <p>{currentAsk?.question || "请回答当前问题"}</p>
                      {Array.isArray(currentAsk?.options) &&
                        currentAsk.options.map((opt, idx) => {
                          const label = opt?.label || `Option ${idx + 1}`;
                          const key = currentAsk?.id || currentAsk?.question || `q_${draft.index}`;
                          const checked = draft.answers[key] === label;
                          return (
                            <label className="pending-option" key={`${label}-${idx}`}>
                              <input
                                type="radio"
                                name={`q_${draft.index}`}
                                checked={checked}
                                onChange={() => setAskDraft({ ...draft, answers: { ...draft.answers, [key]: label } })}
                              />{" "}
                              {label}
                            </label>
                          );
                        })}
                    </fieldset>
                    <div className="pending-actions">
                      <button
                        type="button"
                        disabled={draft.index <= 0}
                        onClick={() => setAskDraft({ ...draft, index: Math.max(0, draft.index - 1) })}
                      >
                        上一题
                      </button>
                      <button
                        type="button"
                        disabled={draft.index >= askQuestions.length - 1}
                        onClick={() => setAskDraft({ ...draft, index: Math.min(askQuestions.length - 1, draft.index + 1) })}
                      >
                        下一题
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          submitPending(activePending.requestId, {
                            behavior: "allow",
                            updatedInput: { ...(activePending.input || {}), answers: draft.answers }
                          })
                        }
                      >
                        提交全部答案
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => submitPending(activePending.requestId, { behavior: "deny", message: "User denied AskUserQuestion." })}
                      >
                        拒绝
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </section>

          <Composer
            blockingPending={blockingPending}
            isStreaming={isStreaming}
            inputText={inputText}
            setInputText={setInputText}
            submitUserMessage={submitUserMessage}
            stop={stop}
            textareaRef={textareaRef}
            skills={skills}
            files={files}
            loadFileSuggestions={loadFileSuggestions}
          />
        </section>
        <InspectorSidebar
          sidebarOpen={sidebarOpen}
          currentWorkspaceId={currentWorkspaceId}
          setCurrentWorkspaceId={setCurrentWorkspaceId}
          workspaces={workspaces}
          skills={skills}
          filteredSkills={filteredSkills}
          skillFilter={skillFilter}
          setSkillFilter={setSkillFilter}
          skillSourceTab={skillSourceTab}
          setSkillSourceTab={setSkillSourceTab}
          skillSourceCounts={skillSourceCounts}
          skillExpanded={skillExpanded}
          setSkillExpanded={setSkillExpanded}
          mcpCatalog={mcpCatalog}
          reloadMcps={() => refreshMcps().catch(() => {})}
          sidebarSections={sidebarSections}
          toggleSidebarSection={toggleSidebarSection}
          sessions={sessions}
          sessionsLoading={sessionsLoading}
          sessionsError={sessionsError}
          openingSessionId={openingSessionId}
          openSession={openSession}
          startNewSession={startNewSession}
          reloadSessions={loadSessions}
          currentSessionId={currentSessionId}
          files={files}
          filteredFiles={filteredFiles}
          fileFilter={fileFilter}
          setFileFilter={setFileFilter}
          openFile={(filePath) => requestOpenFile(filePath).catch(() => {})}
          openedFilePath={openedFile?.path || ""}
          pendingState={pendingState}
          blockingPending={blockingPending}
          diagnostics={diagnostics}
          settings={settings}
          events={events}
        />
      </main>

      <div
        className={`modal ${settingsOpen ? "" : "hidden"}`}
        onClick={() => {
          setSettingsOpen(false);
          setDangerConfirmText("");
        }}
      >
        <div className="modal-card" onClick={(e) => e.stopPropagation()}>
          <div className="modal-head">
            <h2>运行配置</h2>
            <button
              className="btn-secondary"
              type="button"
              onClick={() => {
                setSettingsOpen(false);
                setDangerConfirmText("");
              }}
            >
              关闭
            </button>
          </div>
          <form
            className="settings-form"
            onSubmit={async (event) => {
              event.preventDefault();
              if (settings.permissionProfile === "full_auto" && dangerConfirmText.trim() !== "I UNDERSTAND") {
                window.alert("启用“全部允许”前，请输入 I UNDERSTAND 进行确认。");
                return;
              }
              await saveSettings(settings);
              setDangerConfirmText("");
              setSettingsOpen(false);
            }}
          >
            <label>ANTHROPIC_MODEL</label>
            <input value={settings.model} onChange={(e) => setSettings((s) => ({ ...s, model: e.target.value }))} />
            <label>ANTHROPIC_BASE_URL</label>
            <input value={settings.baseUrl} onChange={(e) => setSettings((s) => ({ ...s, baseUrl: e.target.value }))} />
            <label>ANTHROPIC_AUTH_TOKEN (API Key)</label>
            <input
              type="password"
              value={settings.authToken}
              placeholder={settings.hasToken ? `已保存: ${settings.tokenPreview}` : "请输入 API Key"}
              onChange={(e) => setSettings((s) => ({ ...s, authToken: e.target.value }))}
            />
            <label>MINERU_API_KEY</label>
            <input
              type="password"
              value={settings.mineruApiKey}
              placeholder={settings.hasMineruKey ? `已保存: ${settings.mineruKeyPreview}` : "请输入 MinerU API Key"}
              onChange={(e) => setSettings((s) => ({ ...s, mineruApiKey: e.target.value }))}
            />
            <label>权限模式</label>
            <select
              value={settings.permissionProfile}
              onChange={(e) => {
                const nextMode = e.target.value;
                setSettings((s) => ({
                  ...s,
                  permissionProfile: nextMode,
                  toolGateEnabled: nextMode === "standard" ? s.toolGateEnabled : false
                }));
                if (nextMode !== "full_auto") setDangerConfirmText("");
              }}
            >
              <option value="standard">标准（按需审批）</option>
              <option value="accept_edits">自动接受编辑</option>
              <option value="full_auto">全部允许（高风险）</option>
            </select>
            {settings.permissionProfile === "full_auto" && (
              <>
                <p className="settings-warning">
                  该模式会跳过权限审批，工具可直接执行写文件/命令操作。请仅在可信环境使用。
                </p>
                <label>输入 I UNDERSTAND 以确认</label>
                <input value={dangerConfirmText} onChange={(e) => setDangerConfirmText(e.target.value)} placeholder="I UNDERSTAND" />
              </>
            )}
            <label>审批开关（仅标准模式）</label>
            <select
              value={settings.toolGateEnabled ? "on" : "off"}
              disabled={settings.permissionProfile !== "standard"}
              onChange={(e) => setSettings((s) => ({ ...s, toolGateEnabled: e.target.value === "on" }))}
            >
              <option value="on">ON</option>
              <option value="off">OFF</option>
            </select>
            <div className="pending-actions">
              <button type="submit">保存配置</button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
