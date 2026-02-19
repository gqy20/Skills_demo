import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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
  return error instanceof Error ? error.message : String(error);
}

function shortText(value, max = 120) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function extractSlashCommand(text) {
  const m = String(text || "").trim().match(/^\/([a-zA-Z0-9_-]+)/);
  return m ? m[1].toLowerCase() : "";
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

export default function App() {
  const [workspaces, setWorkspaces] = useState([]);
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState("");
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [runtimeModel, setRuntimeModel] = useState("");
  const [settings, setSettings] = useState({
    model: "",
    baseUrl: "",
    authToken: "",
    hasToken: false,
    tokenPreview: "",
    mineruApiKey: "",
    hasMineruKey: false,
    mineruKeyPreview: "",
    mcpEnabled: true,
    speedModeEnabled: false,
    toolGateEnabled: true,
    debugEnabled: false,
    debugSseEnabled: false
  });
  const [events, setEvents] = useState([]);
  const [runtimeUsage, setRuntimeUsage] = useState({ skills: {}, mcps: {} });
  const [usageExpanded, setUsageExpanded] = useState({ skills: false, mcps: false });
  const [skills, setSkills] = useState([]);
  const [files, setFiles] = useState([]);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [composerToolsOpen, setComposerToolsOpen] = useState(false);
  const [composerMoreOpen, setComposerMoreOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarSections, setSidebarSections] = useState({
    files: false,
    pending: false,
    events: false
  });
  const [skillExpanded, setSkillExpanded] = useState({});
  const [skillFilter, setSkillFilter] = useState("");
  const [skillSourceTab, setSkillSourceTab] = useState("all");
  const [fileFilter, setFileFilter] = useState("");
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
  const controlsRef = useRef(null);
  const composerToolsRef = useRef(null);
  const composerMoreRef = useRef(null);
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

  const { messages, sendMessage, status, stop } = useChat({
    transport,
    onData: (part) => {
      setEvents((prev) => [...prev.slice(-(MAX_EVENT_LOG - 1)), part]);

      if (part?.type === "data-session" && part?.data?.sessionId) {
        setCurrentSessionId(part.data.sessionId);
        return;
      }

      if (part?.type === "data-sdk-init") {
        setRuntimeModel(String(part?.data?.model || ""));
        return;
      }

      if (part?.type === "data-tool-progress") {
        trackMcpUsage(part?.data?.toolName, part?.data?.elapsedSeconds ?? null);
        return;
      }

      if (part?.type === "data-tool-use-summary") {
        const summary = String(part?.data?.summary || "");
        const matched = summary.match(/\/([a-zA-Z0-9_-]+)/g) || [];
        for (const token of matched) {
          trackSkillUsage(token.replace("/", ""), { source: "summary", summary: shortText(summary, 280) });
        }
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
        setDiagnostics((prev) => ({
          ...prev,
          gateHits: prev.gateHits + 1
        }));
        return;
      }

      if (part?.type === "data-ask-user-question-created") {
        setDiagnostics((prev) => ({ ...prev, askCreated: prev.askCreated + 1 }));
        upsertPending("ask_user_question", part.data || {});
        return;
      }

      if (part?.type === "data-permission-request-created") {
        trackMcpUsage(part?.data?.toolName, null);
        upsertPending("permission_request", part.data || {});
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
  const showPreflight = messages.length === 0 && !isStreaming && !lastUserText;
  const runtimeStage = blockingPending
    ? "等待用户输入"
    : isStreaming
      ? diagnostics.gateHits > 0
        ? "工具执行中"
        : "处理中"
      : "空闲";

  const loadWorkspaces = useCallback(async () => {
    const data = await apiGetJson("/api/workspaces", { workspaceId: "" });
    const items = Array.isArray(data.items) ? data.items : [];
    setWorkspaces(items);
    setCurrentWorkspaceId((prev) => prev || data.currentWorkspaceId || items[0]?.id || "");
  }, [apiGetJson]);

  const loadSettings = useCallback(async () => {
    if (!currentWorkspaceId) return;
    const data = await apiGetJson("/api/settings");
    setSettings({
      model: data.model || "",
      baseUrl: data.baseUrl || "",
      authToken: "",
      hasToken: data.hasToken === true,
      tokenPreview: data.tokenPreview || "",
      mineruApiKey: "",
      hasMineruKey: data.hasMineruKey === true,
      mineruKeyPreview: data.mineruKeyPreview || "",
      mcpEnabled: data.mcpEnabled !== false,
      speedModeEnabled: data.speedModeEnabled === true,
      toolGateEnabled: data.toolGateEnabled !== false,
      debugEnabled: data.debugEnabled === true,
      debugSseEnabled: data.debugSseEnabled === true
    });
    setDiagnostics((prev) => ({ ...prev, toolGateEnabled: data.toolGateEnabled !== false }));
  }, [apiGetJson, currentWorkspaceId]);

  const loadSkills = useCallback(async () => {
    if (!currentWorkspaceId) return;
    const data = await apiGetJson("/api/skills");
    setSkills(Array.isArray(data.items) ? data.items : []);
  }, [apiGetJson, currentWorkspaceId]);

  const loadFiles = useCallback(async () => {
    if (!currentWorkspaceId) return;
    const data = await apiGetJson("/api/files", { depth: 1, path: "" });
    setFiles(Array.isArray(data.items) ? data.items : []);
  }, [apiGetJson, currentWorkspaceId]);

  useEffect(() => {
    loadWorkspaces().catch(() => {});
  }, [loadWorkspaces]);

  useEffect(() => {
    loadSettings().catch(() => {});
    loadSkills().catch(() => {});
    loadFiles().catch(() => {});
  }, [currentWorkspaceId, loadFiles, loadSettings, loadSkills]);

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
      if (composerToolsRef.current && composerToolsRef.current.contains(target)) return;
      if (composerMoreRef.current && composerMoreRef.current.contains(target)) return;
      setControlsOpen(false);
      setComposerToolsOpen(false);
      setComposerMoreOpen(false);
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

  const saveSettings = useCallback(
    async (next) => {
      const data = await apiPostJson("/api/settings", {
        ...next,
        keepExistingToken: next.authToken ? false : true,
        keepExistingMineruKey: next.mineruApiKey ? false : true
      });
      setSettings({
        model: data.model || "",
        baseUrl: data.baseUrl || "",
        authToken: "",
        hasToken: data.hasToken === true,
        tokenPreview: data.tokenPreview || "",
        mineruApiKey: "",
        hasMineruKey: data.hasMineruKey === true,
        mineruKeyPreview: data.mineruKeyPreview || "",
        mcpEnabled: data.mcpEnabled !== false,
        speedModeEnabled: data.speedModeEnabled === true,
        toolGateEnabled: data.toolGateEnabled !== false,
        debugEnabled: data.debugEnabled === true,
        debugSseEnabled: data.debugSseEnabled === true
      });
      setCurrentSessionId(null);
      setRuntimeModel("");
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
    setRuntimeUsage({ skills: initialSkillsState, mcps: {} });
    setUsageExpanded({ skills: false, mcps: false });
    await sendMessage({ id: createId(), text });
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

  const filteredFiles = useMemo(() => {
    const q = fileFilter.trim().toLowerCase();
    if (!q) return files;
    return files.filter((item) => `${item?.name || ""} ${item?.path || ""}`.toLowerCase().includes(q));
  }, [files, fileFilter]);

  useEffect(() => {
    autoResizeTextarea();
  }, [inputText, autoResizeTextarea]);

  useEffect(() => {
    if (isStreaming) setComposerMoreOpen(false);
  }, [isStreaming]);

  const toggleSidebarSection = (key) =>
    setSidebarSections((prev) => ({
      ...prev,
      [key]: !prev[key]
    }));

  return (
    <>
      <div className="bg-shape bg-shape-a" />
      <div className="bg-shape bg-shape-b" />
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
                    className={`btn-secondary ${settings.toolGateEnabled ? "" : "is-off"}`}
                    type="button"
                    onClick={async () => {
                      await saveSettings({ ...settings, toolGateEnabled: !settings.toolGateEnabled });
                      setControlsOpen(false);
                    }}
                  >
                    Gate: {settings.toolGateEnabled ? "ON" : "OFF"}
                  </button>
                  <button
                    className="btn-secondary"
                    type="button"
                    onClick={() => {
                      setControlsOpen(false);
                      setSettingsOpen(true);
                    }}
                  >
                    设置
                  </button>
                </div>
              </div>
            </div>
            <div className="runtime-meta">
              <span className="meta-chip">Workspace: {currentWorkspaceId || "-"}</span>
              <span className="meta-chip">Model: {settings.model || "-"}</span>
              <span className="meta-chip">Runtime: {runtimeModel || "-"}</span>
            </div>
            <div className={`runtime-stage runtime-${blockingPending ? "pending" : isStreaming ? "streaming" : "idle"}`}>
              当前阶段: {runtimeStage}
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
                    <strong>运行使用情况</strong>
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
                  </section>
                )}

                {(() => {
                  const lastAssistantId = messages
                    .slice()
                    .reverse()
                    .find((item) => item.role === "assistant")?.id;

                  return messages.map((msg) => {
                    const isLastAssistant = msg.role === "assistant" && lastAssistantId === msg.id;
                    const text = textFromMessage(msg);
                    const hasVisibleText = text.trim().length > 0;
                    const showProcessing = msg.role === "assistant" && isLastAssistant && isStreaming && !hasVisibleText;
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
                            <p>处理中</p>
                          ) : (
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
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

          <form
            className={`composer ${blockingPending ? "is-blocked" : ""}`}
            onSubmit={(event) => {
              event.preventDefault();
              if (isStreaming) {
                stop();
                return;
              }
              submitUserMessage().catch(() => {});
            }}
          >
            <div className="composer-shell">
              <div className="composer-box">
                <div className="composer-prefix" ref={composerToolsRef}>
                  <button
                    type="button"
                    className="btn-secondary composer-icon-btn"
                    aria-label="打开快捷操作"
                    onClick={() => setComposerToolsOpen((v) => !v)}
                  >
                    +
                  </button>
                  <div className={`composer-popover ${composerToolsOpen ? "" : "hidden"}`}>
                    <button
                      type="button"
                      className="composer-popover-item"
                      onClick={() => {
                        setInputText((prev) => `${prev}${prev ? "\n" : ""}/文献综述分析 `);
                        setComposerToolsOpen(false);
                      }}
                    >
                      文献综述分析模板
                    </button>
                    <button
                      type="button"
                      className="composer-popover-item"
                      onClick={() => {
                        setInputText((prev) => `${prev}${prev ? "\n" : ""}@01_articles `);
                        setComposerToolsOpen(false);
                      }}
                    >
                      引用文献目录
                    </button>
                  </div>
                </div>
                <textarea
                  ref={textareaRef}
                  id="message"
                  rows={1}
                  value={inputText}
                  disabled={blockingPending}
                  placeholder="例如：基于当前文献目录，先输出研究问题、方法路线和研究空白。"
                  onChange={(event) => setInputText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      if (isStreaming) {
                        stop();
                        return;
                      }
                      submitUserMessage().catch(() => {});
                    }
                  }}
                />
                <div className="composer-right" ref={composerMoreRef}>
                  <button type="button" className="btn-secondary composer-icon-btn" onClick={() => setComposerMoreOpen((v) => !v)}>
                    ⋯
                  </button>
                  <div className={`composer-popover composer-more ${composerMoreOpen ? "" : "hidden"}`}>
                    <button
                      type="button"
                      className="composer-popover-item"
                      disabled={isStreaming || !lastUserText || blockingPending}
                      onClick={() => submitUserMessage(lastUserText).catch(() => {})}
                    >
                      重新生成
                    </button>
                  </div>
                  <button
                    type="submit"
                    className={`btn-primary composer-send-btn ${isStreaming ? "is-stop" : ""}`}
                    disabled={blockingPending}
                    aria-label={isStreaming ? "停止" : "发送"}
                  >
                    {isStreaming ? "■" : "↑"}
                  </button>
                </div>
              </div>
              <div className="composer-foot">
                <span className="composer-shortcut">`/` 快捷指令 · `@` 引用文件 · Enter 发送</span>
              </div>
            </div>
          </form>
        </section>

        <aside className={`inspector ${sidebarOpen ? "" : "hidden"}`}>
          <section className="panel">
            <h2>Workspace</h2>
            <select value={currentWorkspaceId} onChange={(event) => setCurrentWorkspaceId(event.target.value)}>
              {workspaces.map((ws) => (
                <option key={ws.id} value={ws.id}>
                  {ws.id}
                </option>
              ))}
            </select>
            <p className="session-tag">{workspaces.find((ws) => ws.id === currentWorkspaceId)?.root || ""}</p>
          </section>

          <section className="panel">
            <h2>Skills</h2>
            <div className="panel-toolbar">
              <p className="session-tag">仅显示用户/项目 skills，共 {skills.length} 个</p>
              <input
                className="panel-filter-input"
                value={skillFilter}
                onChange={(event) => setSkillFilter(event.target.value)}
                placeholder="筛选 skills"
              />
              <div className="skills-tabs" role="tablist" aria-label="skills source">
                <button
                  type="button"
                  className={`skills-tab ${skillSourceTab === "all" ? "is-active" : ""}`}
                  onClick={() => setSkillSourceTab("all")}
                >
                  全部 {skillSourceCounts.all}
                </button>
                <button
                  type="button"
                  className={`skills-tab ${skillSourceTab === "project" ? "is-active" : ""}`}
                  onClick={() => setSkillSourceTab("project")}
                >
                  project {skillSourceCounts.project}
                </button>
                <button
                  type="button"
                  className={`skills-tab ${skillSourceTab === "user" ? "is-active" : ""}`}
                  onClick={() => setSkillSourceTab("user")}
                >
                  user {skillSourceCounts.user}
                </button>
              </div>
            </div>
            <ul className="skills-list">
              {filteredSkills.map((item) => {
                const expanded = skillExpanded[item.name] === true;
                return (
                <li className="skills-item" key={item.name}>
                  <div className="skills-head">
                    <p className="skills-name">/{item.name}</p>
                    <span className="skills-source">{item.source}</span>
                  </div>
                  <p className={`skills-desc ${expanded ? "is-expanded" : ""}`}>{item.description || "无描述"}</p>
                  {item.description && item.description.length > 72 && (
                    <button
                      type="button"
                      className="skills-toggle"
                      onClick={() => setSkillExpanded((prev) => ({ ...prev, [item.name]: !expanded }))}
                    >
                      {expanded ? "收起" : "展开"}
                    </button>
                  )}
                </li>
              );
              })}
            </ul>
          </section>

          <section className="panel panel-collapsible">
            <button type="button" className="panel-collapse-btn" onClick={() => toggleSidebarSection("files")}>
              <h2>Files</h2>
              <span>{sidebarSections.files ? "收起" : "展开"}</span>
            </button>
            {sidebarSections.files && (
              <>
                <div className="panel-toolbar">
                  <p className="session-tag">工作区文件 {files.length} 项</p>
                  <input
                    className="panel-filter-input"
                    value={fileFilter}
                    onChange={(event) => setFileFilter(event.target.value)}
                    placeholder="筛选文件"
                  />
                </div>
                <ul className="files-list">
                  {filteredFiles.map((file) => (
                    <li key={file.path}>
                      <span className="files-name">{file.type === "directory" ? "▸ " : "· "}{file.name}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          <section className="panel panel-collapsible">
            <button type="button" className="panel-collapse-btn" onClick={() => toggleSidebarSection("pending")}>
              <h2>Pending Input</h2>
              <span>{sidebarSections.pending ? "收起" : "展开"}</span>
            </button>
            {sidebarSections.pending && (
              <div className="pending-summary">
                <p>
                  <strong>队列:</strong> {pendingState.order.length}
                </p>
                <p>
                  <strong>当前状态:</strong> {blockingPending ? "等待你的输入" : "空闲"}
                </p>
                <p className="hint">
                  Gate={diagnostics.toolGateEnabled ? "ON" : "OFF"} · Hits={diagnostics.gateHits} · Ask=
                  {diagnostics.askCreated}/{diagnostics.askResolved}
                </p>
              </div>
            )}
          </section>

          {settings.debugEnabled && (
            <section className="panel panel-collapsible panel-events">
              <button type="button" className="panel-collapse-btn" onClick={() => toggleSidebarSection("events")}>
                <h2>Events</h2>
                <span>{sidebarSections.events ? "收起" : "展开"}</span>
              </button>
              {sidebarSections.events && <pre className="output">{JSON.stringify(events, null, 2)}</pre>}
            </section>
          )}
        </aside>
      </main>

      <div className={`modal ${settingsOpen ? "" : "hidden"}`} onClick={() => setSettingsOpen(false)}>
        <div className="modal-card" onClick={(e) => e.stopPropagation()}>
          <div className="modal-head">
            <h2>运行配置</h2>
            <button className="btn-secondary" type="button" onClick={() => setSettingsOpen(false)}>
              关闭
            </button>
          </div>
          <form
            className="settings-form"
            onSubmit={async (event) => {
              event.preventDefault();
              await saveSettings(settings);
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
            <div className="pending-actions">
              <button type="submit">保存配置</button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
