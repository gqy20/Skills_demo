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
import { useWorkspaceData } from "./hooks/useWorkspaceData.js";
import { usePendingState } from "./hooks/usePendingState.js";
import { useRuntimeUsage } from "./hooks/useRuntimeUsage.js";
import { useFileEditorActions } from "./hooks/useFileEditorActions.js";
import { useSessionActions } from "./hooks/useSessionActions.js";
import {
  extractSlashCommand,
  flattenFiles,
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

  const { loadWorkspaces, loadSettings, loadSkills, loadFiles, loadMcps, refreshMcps, loadSessions, loadFileSuggestions, saveSettings } =
    useWorkspaceData({
      currentWorkspaceId,
      apiGetJson,
      apiPostJson,
      setWorkspaces,
      setCurrentWorkspaceId,
      setSettings,
      setDiagnostics,
      setSkills,
      setFiles,
      setMcpCatalog,
      setSessions,
      setSessionsLoading,
      setSessionsError,
      setCurrentSessionId
    });
  const { openSession, startNewSession } = useSessionActions({
    apiGetJson,
    isStreaming,
    blockingPending,
    setOpeningSessionId,
    setMessages,
    setTraceByAssistantId,
    setCurrentSessionId,
    setActiveTurnTrace,
    resetPending,
    setEvents,
    setExecutionState,
    setMcpRuntimeStatus,
    setLastUserText,
    resetRuntimeUsage
  });
  const { openFile, requestOpenFile, saveOpenedFile } = useFileEditorActions({
    currentWorkspaceId,
    apiGetJson,
    apiPutJson,
    fileLoading,
    fileSaving,
    openedFile,
    setFileLoading,
    setFileSaving,
    setFileError,
    setOpenedFile,
    loadFiles
  });

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
