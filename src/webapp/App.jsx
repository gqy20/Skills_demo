import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import Composer from "./components/Composer.jsx";
import ChatHeader from "./components/ChatHeader.jsx";
import ChatMessageList from "./components/ChatMessageList.jsx";
import ExecutionPanel from "./components/ExecutionPanel.jsx";
import FileEditorPane from "./components/FileEditorPane.jsx";
import InspectorSidebar from "./components/InspectorSidebar.jsx";
import PendingOverlay from "./components/PendingOverlay.jsx";
import PreflightPanel from "./components/PreflightPanel.jsx";
import SettingsModal from "./components/SettingsModal.jsx";
import UsageStrip from "./components/UsageStrip.jsx";
import { useWorkspaceApi } from "./hooks/useWorkspaceApi.js";
import { usePendingState } from "./hooks/usePendingState.js";
import { useRuntimeUsage } from "./hooks/useRuntimeUsage.js";
import {
  extractSlashCommand,
  flattenFiles,
  normalizeSettings,
  parseError,
  shortText,
  toolLabel
} from "./lib/chatUtils.js";

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

  const {
    usagePanelOpen,
    usageExpanded,
    setUsagePanelOpen,
    setUsageExpanded,
    trackSkillUsage,
    trackMcpUsage,
    resetRuntimeUsage,
    startTurnUsage,
    skillUsageList,
    mcpUsageList
  } = useRuntimeUsage();

  const { apiGetJson, apiPostJson, apiPutJson } = useWorkspaceApi(currentWorkspaceId);
  const {
    pendingState,
    activePending,
    askQuestions,
    draft,
    currentAsk,
    blockingPending,
    upsertPending,
    resolvePending,
    setAskDraft,
    submitPending,
    cancelPending,
    resetPending
  } = usePendingState(apiPostJson);

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
    resetPending();
    setDiagnostics((prev) => ({
      ...prev,
      gateHits: 0,
      askCreated: 0,
      askResolved: 0
    }));
    startTurnUsage(initialSkillsState);
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
      resetPending();
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
    resetRuntimeUsage();
    resetPending();
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
          <ChatHeader
            sidebarOpen={sidebarOpen}
            setSidebarOpen={setSidebarOpen}
            controlsOpen={controlsOpen}
            setControlsOpen={setControlsOpen}
            controlsRef={controlsRef}
            settings={settings}
            currentWorkspaceId={currentWorkspaceId}
            onOpenSettings={() => {
              setControlsOpen(false);
              setSettingsOpen(true);
            }}
            onToggleMcp={async () => {
              await saveSettings({ ...settings, mcpEnabled: !settings.mcpEnabled });
              setControlsOpen(false);
            }}
          />

          <section className="timeline-wrap">
            <section className="timeline" ref={timelineRef}>
              <div className="timeline-inner">
                <PreflightPanel
                  show={showPreflight}
                  quickPrompts={QUICK_PROMPTS}
                  quickChips={QUICK_CHIPS}
                  onSubmitPrompt={(text) => submitUserMessage(text).catch(() => {})}
                  onSelectChip={setInputText}
                />

                <UsageStrip
                  skillUsageList={skillUsageList}
                  mcpUsageList={mcpUsageList}
                  usagePanelOpen={usagePanelOpen}
                  usageExpanded={usageExpanded}
                  setUsagePanelOpen={setUsagePanelOpen}
                  setUsageExpanded={setUsageExpanded}
                />

                <ExecutionPanel
                  show={showExecutionPanel}
                  blockingPending={blockingPending}
                  executionState={executionState}
                  silentSeconds={silentSeconds}
                  isStreaming={isStreaming}
                  settings={settings}
                  mcpRuntimeStatus={mcpRuntimeStatus}
                  showNoDeltaHint={showNoDeltaHint}
                  onDismissNoDelta={() => setExecutionState((prev) => ({ ...prev, dismissNoDelta: true }))}
                  onForceStopAndRetry={forceStopAndRetry}
                />

                <ChatMessageList
                  messages={messages}
                  lastAssistantId={lastAssistantId}
                  isStreaming={isStreaming}
                  traceByAssistantId={traceByAssistantId}
                  onCopyText={copyText}
                  onRetryLast={retryLast}
                  lastUserText={lastUserText}
                />
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

          <PendingOverlay
            blockingPending={blockingPending}
            activePending={activePending}
            askQuestions={askQuestions}
            draft={draft}
            currentAsk={currentAsk}
            setAskDraft={setAskDraft}
            submitPending={submitPending}
            cancelPending={cancelPending}
          />

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

      <SettingsModal
        open={settingsOpen}
        settings={settings}
        setSettings={setSettings}
        dangerConfirmText={dangerConfirmText}
        setDangerConfirmText={setDangerConfirmText}
        onClose={() => {
          setSettingsOpen(false);
          setDangerConfirmText("");
        }}
        onSave={saveSettings}
      />
    </>
  );
}
