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
import SessionSidebar from "./components/SessionSidebar.jsx";
import SettingsModal from "./components/SettingsModal.jsx";
import UsageStrip from "./components/UsageStrip.jsx";
import { useWorkspaceApi } from "./hooks/useWorkspaceApi.js";
import { useWorkspaceData } from "./hooks/useWorkspaceData.js";
import { usePendingState } from "./hooks/usePendingState.js";
import { useRuntimeUsage } from "./hooks/useRuntimeUsage.js";
import { useFileEditorActions } from "./hooks/useFileEditorActions.js";
import { useSessionActions } from "./hooks/useSessionActions.js";
import { useSidebarDerived } from "./hooks/useSidebarDerived.js";
import { useAppEffects } from "./hooks/useAppEffects.js";
import { handleChatStreamError, handleChatStreamPart } from "./lib/chatStreamHandlers.js";
import {
  buildInitialSkillUsage,
  buildQueuedExecutionState,
  buildInitialTurnTrace,
  resetDiagnosticsForTurn
} from "./lib/turnState.js";
import { QUICK_PROMPTS, createId } from "./lib/appConstants.js";
import { extractSlashCommand, parseError, shortText, toolLabel } from "./lib/chatUtils.js";

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
    runtimeEnvText: "",
    permissionProfile: "standard",
    mcpEnabled: true,
    speedModeEnabled: false,
    toolGateEnabled: true,
    debugEnabled: false,
    debugSseEnabled: false
  });
  const [events, setEvents] = useState([]);
  const [hookTimeline, setHookTimeline] = useState([]);
  const [skills, setSkills] = useState([]);
  const [agents, setAgents] = useState([]);
  const [agentUsage, setAgentUsage] = useState({});
  const [files, setFiles] = useState([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState("");
  const [openingSessionId, setOpeningSessionId] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sessionSidebarCollapsed, setSessionSidebarCollapsed] = useState(false);
  const [skillExpanded, setSkillExpanded] = useState({});
  const [skillFilter, setSkillFilter] = useState("");
  const [skillSourceTab, setSkillSourceTab] = useState("all");
  const [fileFilter, setFileFilter] = useState("");
  const [openedFile, setOpenedFile] = useState(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileSaving, setFileSaving] = useState(false);
  const [fileError, setFileError] = useState("");
  const [filesRefreshing, setFilesRefreshing] = useState(false);
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
    phaseDetail: "",
    phaseStartedAt: 0,
    phaseEtaSeconds: null,
    lastActivityAt: 0,
    currentAgent: "",
    currentTool: "",
    toolElapsedSeconds: 0,
    lastDeltaAt: 0,
    taskRuntime: { tasks: {}, running: 0, completed: 0, failed: 0, stopped: 0, parallelPeak: 0 },
    actions: [],
    dismissNoDelta: false
  });
  const [mcpRuntimeStatus, setMcpRuntimeStatus] = useState({
    ok: null,
    count: 0,
    error: "",
    status: "unknown"
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
  const textareaRef = useRef(null);
  const timelineRef = useRef(null);
  const currentSessionIdRef = useRef(null);
  const currentWorkspaceIdRef = useRef("");

  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  useEffect(() => {
    currentWorkspaceIdRef.current = currentWorkspaceId;
  }, [currentWorkspaceId]);

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
            id: currentSessionIdRef.current || undefined,
            workspaceId: currentWorkspaceIdRef.current || undefined,
            messages
          }
        })
      }),
    []
  );

  const { messages, setMessages, sendMessage, status, stop } = useChat({
    transport,
    onData: (part) =>
      handleChatStreamPart(part, {
        setEvents,
        now: Date.now(),
        setCurrentSessionId,
        setActiveTurnTrace,
        loadSessions,
        loadMcps,
        setMcpRuntimeStatus,
        setExecutionState,
        trackMcpUsage,
        setDiagnostics,
        upsertPending,
        resolvePending,
        trackSkillUsage,
        trackAgentUsage: (agentName, event = "start") => {
          const name = String(agentName || "").trim();
          if (!name) return;
          setAgentUsage((prev) => {
            const old = prev[name] || { count: 0, lastUsedAt: 0, lastEvent: "" };
            return {
              ...prev,
              [name]: {
                count: event === "start" ? old.count + 1 : old.count,
                lastUsedAt: Date.now(),
                lastEvent: String(event || "")
              }
            };
          });
        },
        toolLabel,
        shortText,
        setHookTimeline
      }),
    onError: (error) => handleChatStreamError(error, { setEvents, parseError })
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

  useEffect(() => {
    if (!lastAssistantId || !activeTurnTrace?.completedAt) return;
    setTraceByAssistantId((prev) => {
      if (prev[lastAssistantId]) return prev;
      return { ...prev, [lastAssistantId]: activeTurnTrace };
    });
    setActiveTurnTrace(null);
  }, [activeTurnTrace, lastAssistantId]);

  const {
    loadWorkspaces,
    loadSettings,
    loadSkills,
    loadAgents,
    loadFiles,
    loadMcps,
    refreshMcps,
    loadSessions,
    loadFileSuggestions,
    saveSettings
  } = useWorkspaceData({
    currentWorkspaceId,
    apiGetJson,
    apiPostJson,
    setWorkspaces,
    setCurrentWorkspaceId,
    setSettings,
    setDiagnostics,
    setSkills,
    setAgents,
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
    setAgentUsage,
    setLastUserText,
    resetRuntimeUsage,
    setHookTimeline
  });
  const deleteSession = async (sessionId) => {
    if (!sessionId) return;
    try {
      await fetch(`/api/sessions/${encodeURIComponent(sessionId)}?workspaceId=${encodeURIComponent(currentWorkspaceId)}`, {
        method: "DELETE"
      });
    } catch {
      // ignore
    }
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    if (currentSessionId === sessionId) startNewSession();
  };
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

  const refreshFiles = useCallback(async () => {
    if (!currentWorkspaceId || filesRefreshing) return;
    setFilesRefreshing(true);
    try {
      await loadFiles();
    } finally {
      setFilesRefreshing(false);
    }
  }, [currentWorkspaceId, filesRefreshing, loadFiles]);

  useAppEffects({
    loadWorkspaces,
    currentWorkspaceId,
    loadSettings,
    loadSkills,
    loadAgents,
    loadMcps,
    loadFiles,
    loadSessions,
    setOpenedFile,
    setFileLoading,
    setFileSaving,
    setFileError,
    timelineRef,
    messages,
    isStreaming,
    blockingPending,
    setNowTick,
    inputText,
    textareaRef
  });

  const submitUserMessage = async (overrideText = null) => {
    const text = (overrideText ?? inputText).trim();
    if (!text || isStreaming || blockingPending) return;
    const now = Date.now();
    const initialSkill = extractSlashCommand(text);
    const initialSkillsState = buildInitialSkillUsage(text, initialSkill, now);
    setLastUserText(text);
    setInputText("");
    setEvents([]);
    setHookTimeline([{ stage: "queued", at: now, source: "ui" }]);
    setAgentUsage({});
    resetPending();
    setDiagnostics(resetDiagnosticsForTurn);
    startTurnUsage(initialSkillsState);
    setExecutionState(buildQueuedExecutionState(now));
    setMcpRuntimeStatus({ ok: null, count: 0, error: "", status: "unknown" });
    setActiveTurnTrace(buildInitialTurnTrace(now));
    await sendMessage({ id: createId(), text });
  };

  const retryLast = () => {
    if (!lastUserText || isStreaming) return;
    setMessages((prev) => {
      let i = prev.length - 1;
      // 跳过末尾所有 assistant 消息
      while (i >= 0 && prev[i].role !== "user") i--;
      // 再跳过最后一条 user 消息（即 lastUserText 那条）
      while (i >= 0 && prev[i].role === "user") i--;
      return prev.slice(0, i + 1);
    });
    // 延一帧等 React 刷新后再重提，避免 sendMessage 读到旧消息列表
    setTimeout(() => submitUserMessage(lastUserText).catch(() => {}), 0);
  };
  const copyText = async (text) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore clipboard failures in unsupported environments
    }
  };

  const { skillSourceCounts, filteredSkills, filteredFiles } = useSidebarDerived({
    skills,
    skillSourceTab,
    skillFilter,
    files,
    fileFilter
  });
  const effectiveMcpRuntimeStatus = useMemo(() => {
    const runtime = mcpCatalog?.runtime || {};
    const connectedCount = Array.isArray(mcpCatalog?.items)
      ? mcpCatalog.items.filter((item) => item?.runtime?.connected === true || item?.runtime?.status === "connected").length
      : 0;
    if (runtime.checking === true) {
      return { ok: null, count: 0, error: "", status: "checking" };
    }
    if (runtime.ok === true && runtime.stale === false) {
      return { ok: true, count: connectedCount, error: "", status: "ok" };
    }
    if (runtime.ok === false && runtime.stale === false) {
      const error = String(runtime.error || "");
      return {
        ok: false,
        count: 0,
        error,
        status: /timed out/i.test(error) ? "timeout" : "error"
      };
    }
    return mcpRuntimeStatus;
  }, [mcpCatalog, mcpRuntimeStatus]);
  const effectiveMcpProbeRuntime = useMemo(() => {
    const runtime = mcpCatalog?.runtime || {};
    if (runtime.checking === true || runtime.stale === false || runtime.ok === true || runtime.ok === false) {
      return runtime;
    }
    return {
      ok: mcpRuntimeStatus.ok,
      error: mcpRuntimeStatus.error,
      source: "stream_probe",
      checking: mcpRuntimeStatus.status === "checking",
      lastCheckedAt: null,
      ageSeconds: null
    };
  }, [mcpCatalog, mcpRuntimeStatus]);
  const mcpProbeHasIssue = effectiveMcpProbeRuntime?.ok === false;
  const showExecutionPanel =
    isStreaming || blockingPending || executionState.phase === "error" || showNoDeltaHint || (isStreaming && mcpProbeHasIssue);

  useEffect(() => {
    if (!currentWorkspaceId) return;
    const timer = setInterval(() => {
      if (document.hidden || isStreaming || blockingPending || openingSessionId) return;
      loadSessions().catch(() => {});
    }, 4000);
    return () => clearInterval(timer);
  }, [blockingPending, currentWorkspaceId, isStreaming, loadSessions, openingSessionId]);

  useEffect(() => {
    if (!currentWorkspaceId) return;
    const timer = setInterval(() => {
      if (document.hidden || filesRefreshing) return;
      refreshFiles().catch(() => {});
    }, 10000);
    return () => clearInterval(timer);
  }, [currentWorkspaceId, filesRefreshing, refreshFiles]);

  useEffect(() => {
    if (!currentWorkspaceId) return;
    if (mcpCatalog?.runtime?.checking !== true) return;
    const timer = setInterval(() => {
      if (document.hidden) return;
      loadMcps().catch(() => {});
    }, 1200);
    return () => clearInterval(timer);
  }, [currentWorkspaceId, loadMcps, mcpCatalog?.runtime?.checking]);

  const loadDirectoryChildren = async (dirPath) => {
    const target = String(dirPath || "").trim();
    if (!target || !currentWorkspaceId) return;
    const data = await apiGetJson("/api/files", { path: target, depth: 2 });
    const children = Array.isArray(data?.items) ? data.items : [];
    const patchTree = (items) =>
      (Array.isArray(items) ? items : []).map((item) => {
        if (!item || typeof item !== "object") return item;
        if (item.type === "directory" && item.path === target) {
          return { ...item, children, hasChildren: children.length > 0 };
        }
        if (item.type === "directory" && Array.isArray(item.children)) {
          return { ...item, children: patchTree(item.children) };
        }
        return item;
      });
    setFiles((prev) => patchTree(prev));
  };

  const fileFocused = Boolean(openedFile?.path);

  return (
    <>
      <main className={`workspace ${sidebarOpen ? "workspace-with-sidebar" : "workspace-chat-only"}${sessionSidebarCollapsed ? " session-sidebar-collapsed" : ""}`}>
        <SessionSidebar
          sessions={sessions}
          sessionsLoading={sessionsLoading}
          currentSessionId={currentSessionId}
          openingSessionId={openingSessionId}
          onOpenSession={openSession}
          onNewSession={startNewSession}
          onDeleteSession={deleteSession}
          isStreaming={isStreaming}
          blockingPending={blockingPending}
          collapsed={sessionSidebarCollapsed}
          onToggleCollapse={() => setSessionSidebarCollapsed((v) => !v)}
          files={files}
          filteredFiles={filteredFiles}
          fileFilter={fileFilter}
          setFileFilter={setFileFilter}
          openFile={(filePath) => requestOpenFile(filePath).catch(() => {})}
          loadDirectoryChildren={(dirPath) => loadDirectoryChildren(dirPath).catch(() => {})}
          onRefreshFiles={() => refreshFiles().catch(() => {})}
          filesRefreshing={filesRefreshing}
          openedFilePath={openedFile?.path || ""}
        />
        <section className={`chat-shell ${fileFocused ? "file-focus-mode" : ""}`}>
          {!openedFile?.path && (
            <ChatHeader
              sidebarOpen={sidebarOpen}
              setSidebarOpen={setSidebarOpen}
              settings={settings}
              currentWorkspaceId={currentWorkspaceId}
              onOpenSettings={() => {
                setSettingsOpen(true);
              }}
              onToggleMcp={async () => {
                await saveSettings({ ...settings, mcpEnabled: !settings.mcpEnabled });
              }}
            />
          )}

          {!fileFocused && (
            <section className="timeline-wrap">
              <div className="timeline-status-dock">
                <ExecutionPanel
                  show={showExecutionPanel}
                  blockingPending={blockingPending}
                  executionState={executionState}
                  silentSeconds={silentSeconds}
                  isStreaming={isStreaming}
                  settings={settings}
                  mcpRuntimeStatus={effectiveMcpRuntimeStatus}
                  mcpProbeRuntime={effectiveMcpProbeRuntime}
                  skillUsageList={skillUsageList}
                  hookTimeline={hookTimeline}
                  showNoDeltaHint={showNoDeltaHint}
                  nowTick={nowTick}
                  showHookTimeline={settings.debugEnabled}
                />
              </div>
              <section className="timeline" ref={timelineRef}>
                <div className="timeline-inner">
                  <PreflightPanel
                    show={showPreflight}
                    quickPrompts={QUICK_PROMPTS}
                    onSubmitPrompt={(text) => submitUserMessage(text).catch(() => {})}
                  />

                  <UsageStrip
                    skillUsageList={skillUsageList}
                    mcpUsageList={mcpUsageList}
                    usagePanelOpen={usagePanelOpen}
                    usageExpanded={usageExpanded}
                    setUsagePanelOpen={setUsagePanelOpen}
                    setUsageExpanded={setUsageExpanded}
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
          )}

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

          {!fileFocused && (
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
          )}
        </section>
        <InspectorSidebar
          sidebarOpen={sidebarOpen}
          skills={skills}
          agents={agents}
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
          onOpenSettings={() => setSettingsOpen(true)}
          pendingState={pendingState}
          blockingPending={blockingPending}
          diagnostics={diagnostics}
          settings={settings}
          events={events}
          agentUsage={agentUsage}
        />
      </main>

      <SettingsModal
        open={settingsOpen}
        settings={settings}
        setSettings={setSettings}
        mcpCatalog={mcpCatalog}
        onClose={() => {
          setSettingsOpen(false);
        }}
        onSave={async (next) => {
          await saveSettings(next);
          await loadMcps();
        }}
      />
    </>
  );
}
