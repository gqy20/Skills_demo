import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const MAX_EVENT_LOG = 120;

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

export default function App() {
  const [workspaces, setWorkspaces] = useState([]);
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState("");
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [settings, setSettings] = useState({
    model: "",
    baseUrl: "",
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
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [inputText, setInputText] = useState("");
  const [lastUserText, setLastUserText] = useState("");
  const [pendingState, setPendingState] = useState({
    byId: {},
    order: [],
    history: [],
    activeId: null,
    drafts: {}
  });
  const [diagnostics, setDiagnostics] = useState({
    toolGateEnabled: true,
    gateHits: 0,
    askCreated: 0,
    askResolved: 0,
    lastToolName: "",
    lastEvent: ""
  });
  const controlsRef = useRef(null);

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

  const resolvePending = useCallback((data, status) => {
    const requestId = data?.requestId;
    if (!requestId) return;
    setPendingState((prev) => {
      const target = prev.byId[requestId];
      if (!target) return prev;
      const nextById = { ...prev.byId };
      delete nextById[requestId];
      const nextOrder = prev.order.filter((id) => id !== requestId);
      const nextHistory = [{ requestId, kind: target.kind, toolName: target.toolName, status }, ...prev.history].slice(
        0,
        12
      );
      return {
        ...prev,
        byId: nextById,
        order: nextOrder,
        history: nextHistory,
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
      if (part?.type === "data-tool-gate-status") {
        setDiagnostics((prev) => ({
          ...prev,
          toolGateEnabled: part?.data?.enabled !== false,
          lastEvent: `tool-gate-status:${part?.data?.enabled !== false ? "on" : "off"}`
        }));
        return;
      }
      if (part?.type === "data-tool-gate-hit") {
        setDiagnostics((prev) => ({
          ...prev,
          gateHits: prev.gateHits + 1,
          lastToolName: String(part?.data?.toolName || ""),
          lastEvent: `gate-hit:${String(part?.data?.toolName || "unknown")}`
        }));
        return;
      }
      if (part?.type === "data-ask-user-question-created") {
        setDiagnostics((prev) => ({ ...prev, askCreated: prev.askCreated + 1, lastEvent: "ask-created" }));
        upsertPending("ask_user_question", part.data || {});
        return;
      }
      if (part?.type === "data-permission-request-created") {
        upsertPending("permission_request", part.data || {});
        return;
      }
      if (
        part?.type === "data-ask-user-question-resolved" ||
        part?.type === "data-ask-user-question-timeout" ||
        part?.type === "data-ask-user-question-canceled"
      ) {
        setDiagnostics((prev) => ({ ...prev, askResolved: prev.askResolved + 1, lastEvent: String(part.type) }));
        resolvePending(part.data || {}, part.type.split("-").slice(-1)[0]);
        return;
      }
      if (
        part?.type === "data-permission-request-resolved" ||
        part?.type === "data-permission-request-timeout" ||
        part?.type === "data-permission-request-canceled"
      ) {
        resolvePending(part.data || {}, part.type.split("-").slice(-1)[0]);
      }
    },
    onError: (error) => {
      setEvents((prev) => [...prev.slice(-(MAX_EVENT_LOG - 1)), { type: "error", error: parseError(error) }]);
    }
  });

  const isStreaming = status === "submitted" || status === "streaming";
  const blockingPending = Boolean(activePending);

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
      setControlsOpen(false);
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  const saveSettings = useCallback(
    async (next) => {
      const data = await apiPostJson("/api/settings", {
        ...next,
        keepExistingToken: true
      });
      setSettings({
        model: data.model || "",
        baseUrl: data.baseUrl || "",
        mcpEnabled: data.mcpEnabled !== false,
        speedModeEnabled: data.speedModeEnabled === true,
        toolGateEnabled: data.toolGateEnabled !== false,
        debugEnabled: data.debugEnabled === true,
        debugSseEnabled: data.debugSseEnabled === true
      });
      setDiagnostics((prev) => ({ ...prev, toolGateEnabled: data.toolGateEnabled !== false }));
      return data;
    },
    [apiPostJson]
  );

  const submitUserMessage = async (overrideText = null) => {
    const text = (overrideText ?? inputText).trim();
    if (!text || isStreaming || blockingPending) return;
    setLastUserText(text);
    setInputText("");
    setEvents([]);
    setPendingState({ byId: {}, order: [], history: [], activeId: null, drafts: {} });
    setDiagnostics((prev) => ({
      ...prev,
      gateHits: 0,
      askCreated: 0,
      askResolved: 0,
      lastToolName: "",
      lastEvent: ""
    }));
    await sendMessage({ id: createId(), text });
  };

  const submitPending = async (requestId, payload) => {
    await apiPostJson("/api/input", { requestId, ...payload });
    resolvePending({ requestId }, payload.behavior === "deny" ? "deny" : "allow");
  };

  const cancelPending = async (requestId) => {
    await apiPostJson("/api/input/cancel", { requestId });
    resolvePending({ requestId }, "canceled");
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
                    className={`btn-secondary ${settings.speedModeEnabled ? "" : "is-off"}`}
                    type="button"
                    onClick={async () => {
                      await saveSettings({ ...settings, speedModeEnabled: !settings.speedModeEnabled });
                      setControlsOpen(false);
                    }}
                  >
                    Speed: {settings.speedModeEnabled ? "ON" : "OFF"}
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
            <p>AI SDK useChat + Claude Agent SDK</p>
          </header>

          <section className="timeline-wrap">
            <section className="timeline">
              <div className="timeline-inner">
                {messages.length === 0 && (
                  <article className="bubble bubble-assistant">
                    <p>准备就绪。输入任务后将实时显示回复。</p>
                  </article>
                )}
                {(() => {
                  const lastAssistantId = messages
                    .slice()
                    .reverse()
                    .find((item) => item.role === "assistant")?.id;
                  return messages.map((msg) => {
                    const isLastAssistant = msg.role === "assistant" && lastAssistantId === msg.id;
                    const text = textFromMessage(msg);
                    return (
                      <article
                        key={msg.id}
                        className={`bubble ${msg.role === "user" ? "bubble-user" : "bubble-assistant"} ${
                          isLastAssistant && isStreaming ? "bubble-streaming" : ""
                        }`}
                      >
                        {msg.role === "assistant" ? (
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{text || ""}</ReactMarkdown>
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
                        onClick={() =>
                          submitPending(activePending.requestId, { behavior: "deny", message: "User denied from web UI." })
                        }
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
                                onChange={() =>
                                  setAskDraft({ ...draft, answers: { ...draft.answers, [key]: label } })
                                }
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
                        onClick={() =>
                          setAskDraft({ ...draft, index: Math.min(askQuestions.length - 1, draft.index + 1) })
                        }
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
                        onClick={() =>
                          submitPending(activePending.requestId, {
                            behavior: "deny",
                            message: "User denied AskUserQuestion."
                          })
                        }
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
              submitUserMessage().catch(() => {});
            }}
          >
            <label htmlFor="message">Prompt</label>
            <textarea
              id="message"
              rows={4}
              value={inputText}
              disabled={blockingPending}
              placeholder="例如：/commander status"
              onChange={(event) => setInputText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  submitUserMessage().catch(() => {});
                }
              }}
            />
            <div className="composer-actions">
              <button type="submit" disabled={isStreaming || blockingPending}>
                发送
              </button>
              <button type="button" className="btn-secondary" disabled={!isStreaming} onClick={() => stop()}>
                停止
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={isStreaming || !lastUserText || blockingPending}
                onClick={() => submitUserMessage(lastUserText).catch(() => {})}
              >
                重试
              </button>
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
            <h2>Session</h2>
            <p className="session-tag">Session: {currentSessionId || "(new)"}</p>
          </section>

          <section className="panel">
            <h2>Skills</h2>
            <p className="session-tag">仅显示用户/项目 skills，共 {skills.length} 个</p>
            <ul className="skills-list">
              {skills.map((item) => (
                <li className="skills-item" key={item.name}>
                  <div className="skills-head">
                    <p className="skills-name">/{item.name}</p>
                    <span className="skills-source">{item.source}</span>
                  </div>
                  <p className="skills-desc">{item.description || "无描述"}</p>
                </li>
              ))}
            </ul>
          </section>

          <section className="panel">
            <h2>Files</h2>
            <p className="session-tag">工作区文件 {files.length} 项</p>
            <ul className="files-list">
              {files.map((file) => (
                <li key={file.path}>
                  <span className="files-name">{file.type === "directory" ? "▸ " : "· "}{file.name}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="panel">
            <h2>Pending Input</h2>
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
          </section>

          <section className="panel panel-events">
            <h2>Events</h2>
            <pre className="output">{JSON.stringify(events, null, 2)}</pre>
          </section>
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
            <label className="pending-option">
              <input
                type="checkbox"
                checked={settings.mcpEnabled}
                onChange={(e) => setSettings((s) => ({ ...s, mcpEnabled: e.target.checked }))}
              />
              启用 MCP
            </label>
            <label className="pending-option">
              <input
                type="checkbox"
                checked={settings.speedModeEnabled}
                onChange={(e) => setSettings((s) => ({ ...s, speedModeEnabled: e.target.checked }))}
              />
              启用性能模式
            </label>
            <label className="pending-option">
              <input
                type="checkbox"
                checked={settings.toolGateEnabled}
                onChange={(e) => setSettings((s) => ({ ...s, toolGateEnabled: e.target.checked }))}
              />
              启用交互网关
            </label>
            <div className="pending-actions">
              <button type="submit">保存配置</button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
