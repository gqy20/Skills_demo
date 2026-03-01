import { useEffect, useMemo, useRef, useState } from "react";
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
import { useSidebarDerived } from "./hooks/useSidebarDerived.js";
import { useAppEffects } from "./hooks/useAppEffects.js";
import { handleChatStreamError, handleChatStreamPart } from "./lib/chatStreamHandlers.js";
import {
  buildInitialSkillUsage,
  buildQueuedExecutionState,
  buildInitialTurnTrace,
  resetDiagnosticsForTurn
} from "./lib/turnState.js";
import { QUICK_PROMPTS, QUICK_CHIPS, createId } from "./lib/appConstants.js";
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
    mineruApiKey: "",
    hasMineruKey: false,
    mineruKeyPreview: "",
    mcpEnvText: "",
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
  const controlsRef = useRef(null);
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
        setMcpRuntimeStatus,
        setExecutionState,
        trackMcpUsage,
        setDiagnostics,
        upsertPending,
        resolvePending,
        trackSkillUsage,
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
    resetRuntimeUsage,
    setHookTimeline
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

  useAppEffects({
    loadWorkspaces,
    currentWorkspaceId,
    loadSettings,
    loadSkills,
    loadMcps,
    loadFiles,
    loadSessions,
    setOpenedFile,
    setFileLoading,
    setFileSaving,
    setFileError,
    controlsRef,
    setControlsOpen,
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
    resetPending();
    setDiagnostics(resetDiagnosticsForTurn);
    startTurnUsage(initialSkillsState);
    setExecutionState(buildQueuedExecutionState(now));
    setMcpRuntimeStatus({ ok: null, count: 0, error: "", status: "unknown" });
    setActiveTurnTrace(buildInitialTurnTrace(now));
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
                  mcpRuntimeStatus={effectiveMcpRuntimeStatus}
                  mcpProbeRuntime={effectiveMcpProbeRuntime}
                  hookTimeline={hookTimeline}
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
