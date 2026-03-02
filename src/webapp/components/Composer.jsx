import { useEffect, useMemo, useRef, useState } from "react";
const MAX_SUGGESTIONS = 20;

function flattenFiles(items, out = []) {
  if (!Array.isArray(items)) return out;
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const path = String(item.path || "").trim();
    const type = item.type === "directory" ? "directory" : "file";
    if (path) out.push({ path, type });
    if (Array.isArray(item.children) && item.children.length > 0) {
      flattenFiles(item.children, out);
    }
  }
  return out;
}

function detectActiveToken(text, caretPos) {
  const textSafe = String(text || "");
  const caret = Math.max(0, Math.min(Number.isFinite(caretPos) ? caretPos : textSafe.length, textSafe.length));
  const before = textSafe.slice(0, caret);
  let start = before.length - 1;
  while (start >= 0 && !/\s/.test(before[start])) start -= 1;
  start += 1;
  const token = before.slice(start);
  if (!token || (token[0] !== "/" && token[0] !== "@")) return null;
  return {
    trigger: token[0],
    query: token.slice(1),
    start,
    end: caret
  };
}

function splitPathQuery(rawQuery) {
  const q = String(rawQuery || "").trim().toLowerCase();
  if (!q) return { basePrefix: "", leafQuery: "" };
  const slash = q.lastIndexOf("/");
  if (slash < 0) return { basePrefix: "", leafQuery: q };
  return {
    basePrefix: q.slice(0, slash + 1),
    leafQuery: q.slice(slash + 1)
  };
}

function scorePathSuggestion(pathValue, type, rawQuery) {
  const pathLower = String(pathValue || "").toLowerCase();
  const { basePrefix, leafQuery } = splitPathQuery(rawQuery);
  const segments = pathLower.split("/");
  const baseName = segments[segments.length - 1] || pathLower;
  let score = 0;

  if (!rawQuery) score += 1;
  if (leafQuery && baseName === leafQuery) score += 60;
  if (leafQuery && baseName.startsWith(leafQuery)) score += 26;
  if (leafQuery && baseName.includes(leafQuery)) score += 16;
  if (rawQuery && pathLower.startsWith(rawQuery)) score += 24;
  if (rawQuery && pathLower.includes(rawQuery)) score += 12;
  if (basePrefix && pathLower.startsWith(basePrefix)) score += 10;
  if (type === "file") score += 4;

  return score;
}

function pathBaseName(pathValue) {
  const pathSafe = String(pathValue || "").trim();
  if (!pathSafe) return "";
  const segments = pathSafe.split("/");
  return segments[segments.length - 1] || pathSafe;
}

function toErrorMessage(error) {
  if (error instanceof Error && error.message) return error.message;
  return "联想加载失败";
}

export default function Composer({
  blockingPending,
  isStreaming,
  inputText,
  setInputText,
  submitUserMessage,
  stop,
  textareaRef,
  skills,
  files,
  loadFileSuggestions
}) {
  const [caretPos, setCaretPos] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [remoteFileCandidates, setRemoteFileCandidates] = useState([]);
  const [suggestError, setSuggestError] = useState("");
  const [dismissedTokenKey, setDismissedTokenKey] = useState("");
  const [insertedHint, setInsertedHint] = useState("");
  const fileCandidates = useMemo(() => flattenFiles(files || []), [files]);
  const activeToken = useMemo(() => detectActiveToken(inputText, caretPos), [inputText, caretPos]);
  const tokenKey = activeToken ? `${activeToken.trigger}:${activeToken.start}:${activeToken.query}` : "";

  useEffect(() => {
    if (!activeToken || activeToken.trigger !== "@") {
      setRemoteFileCandidates([]);
      setSuggestError("");
      return;
    }
    if (typeof loadFileSuggestions !== "function") {
      setRemoteFileCandidates([]);
      setSuggestError("未配置文件联想接口");
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      loadFileSuggestions(activeToken.query)
        .then((items) => {
          if (cancelled) return;
          setSuggestError("");
          setRemoteFileCandidates(flattenFiles(items || []));
        })
        .catch((error) => {
          if (cancelled) return;
          setSuggestError(toErrorMessage(error));
          setRemoteFileCandidates([]);
        });
    }, 120);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [activeToken, loadFileSuggestions]);

  const suggestions = useMemo(() => {
    if (!activeToken) return [];
    const q = activeToken.query.trim().toLowerCase();
    if (activeToken.trigger === "/") {
      const base = Array.isArray(skills)
        ? skills.map((item) => ({
            key: String(item?.name || "").trim(),
            value: String(item?.name || "").trim(),
            title: `/${String(item?.name || "").trim()}`,
            desc: String(item?.description || "").trim(),
            kind: "skill"
          }))
        : [];
      const filtered = base.filter((item) => {
        if (!item.value) return false;
        if (!q) return true;
        return item.value.toLowerCase().includes(q) || item.desc.toLowerCase().includes(q);
      });
      return filtered.slice(0, MAX_SUGGESTIONS);
    }

    const merged = new Map();
    for (const item of remoteFileCandidates) {
      const key = String(item.path || "").trim();
      if (!key) continue;
      merged.set(key, item);
    }
    for (const item of fileCandidates) {
      const key = String(item.path || "").trim();
      if (!key || merged.has(key)) continue;
      merged.set(key, item);
    }

    const ranked = Array.from(merged.values())
      .filter((item) => {
        const pathLower = item.path.toLowerCase();
        if (!q) return true;
        const { basePrefix, leafQuery } = splitPathQuery(q);
        if (basePrefix) {
          if (!pathLower.startsWith(basePrefix)) return false;
          if (!leafQuery) return true;
          const remainder = pathLower.slice(basePrefix.length);
          const nextSegment = remainder.split("/")[0] || "";
          return nextSegment.includes(leafQuery);
        }
        return pathLower.includes(leafQuery);
      })
      .sort((a, b) => {
        const sa = scorePathSuggestion(a.path, a.type, q);
        const sb = scorePathSuggestion(b.path, b.type, q);
        if (sa !== sb) return sb - sa;
        return a.path.length - b.path.length;
      })
      .slice(0, MAX_SUGGESTIONS)
      .map((item) => {
        const base = pathBaseName(item.path);
        const parentDir = item.path.includes("/")
          ? item.path.split("/").slice(0, -1).join("/")
          : "";
        return {
          key: item.path,
          value: item.path,
          title: base,
          desc: parentDir,
          kind: "path",
          fileType: item.type
        };
      });
    return ranked;
  }, [activeToken, skills, fileCandidates, remoteFileCandidates]);

  const suggestOpen = Boolean(activeToken && suggestions.length > 0 && !blockingPending);
  const suggestListRef = useRef(null);

  useEffect(() => {
    setActiveIndex(0);
  }, [suggestOpen, inputText, tokenKey]);

  // 键盘导航时将活跃条目滚入可视区域
  useEffect(() => {
    const container = suggestListRef.current;
    if (!container) return;
    const item = container.querySelector(`[data-suggest-idx="${activeIndex}"]`);
    if (item) item.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  useEffect(() => {
    if (!insertedHint) return undefined;
    const timer = setTimeout(() => setInsertedHint(""), 1200);
    return () => clearTimeout(timer);
  }, [insertedHint]);

  const applySuggestion = (index) => {
    if (!activeToken) return;
    const item = suggestions[index];
    if (!item) return;
    const replacement = `${activeToken.trigger}${item.value} `;
    const nextText = `${inputText.slice(0, activeToken.start)}${replacement}${inputText.slice(activeToken.end)}`;
    const nextCaret = activeToken.start + replacement.length;
    setInputText(nextText);
    requestAnimationFrame(() => {
      const el = textareaRef?.current;
      if (!el) return;
      el.focus();
      el.selectionStart = nextCaret;
      el.selectionEnd = nextCaret;
      setCaretPos(nextCaret);
    });
    setDismissedTokenKey("");
    setInsertedHint(`${activeToken.trigger}${item.value}`);
  };

  const showEmptySuggest = Boolean(activeToken && !blockingPending && !suggestions.length && activeToken.query.length > 0);
  const showSuggest = Boolean((suggestOpen || showEmptySuggest) && tokenKey !== dismissedTokenKey);
  const composerStatus = blockingPending
    ? "等待确认输入"
    : showSuggest && suggestions.length > 0
      ? "↑↓ 选择 · Enter 确认"
      : insertedHint
        ? `已插入 ${insertedHint}`
        : inputText.trim()
          ? "Enter 发送 · Shift+Enter 换行"
          : "输入内容后发送";

  return (
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
          <textarea
            ref={textareaRef}
            id="message"
            rows={1}
            value={inputText}
            disabled={blockingPending}
            placeholder="例如：基于当前文献目录，先输出研究问题、方法路线和研究空白。"
            onChange={(event) => {
              setInputText(event.target.value);
              setCaretPos(event.target.selectionStart ?? event.target.value.length);
            }}
            onClick={(event) => setCaretPos(event.currentTarget.selectionStart ?? 0)}
            onKeyUp={(event) => setCaretPos(event.currentTarget.selectionStart ?? 0)}
            onKeyDown={(event) => {
              if (showSuggest && suggestions.length > 0) {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActiveIndex((prev) => (prev + 1) % suggestions.length);
                  return;
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActiveIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
                  return;
                }
                if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
                  event.preventDefault();
                  applySuggestion(activeIndex);
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setDismissedTokenKey(tokenKey);
                  return;
                }
              } else if (showSuggest && event.key === "Escape") {
                event.preventDefault();
                setDismissedTokenKey(tokenKey);
                return;
              }

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
          <div className={`composer-suggest ${showSuggest ? "" : "hidden"}`} ref={suggestListRef}>
            {suggestions.length > 0 ? (
              suggestions.map((item, idx) => (
                <button
                  key={`${item.kind}-${item.key}`}
                  type="button"
                  data-suggest-idx={idx}
                  className={`composer-suggest-item ${idx === activeIndex ? "is-active" : ""}`}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    applySuggestion(idx);
                  }}
                >
                  <span className="composer-suggest-icon" aria-hidden="true">
                    {item.kind === "path" && item.fileType === "directory" ? (
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path d="M1 4.5C1 3.67 1.67 3 2.5 3H5l1.2 1.5H11.5C12.33 4.5 13 5.17 13 6v4.5C13 11.33 12.33 12 11.5 12h-9C1.67 12 1 11.33 1 10.5V4.5z" fill="#93c5fd" stroke="#60a5fa" strokeWidth="0.8"/>
                      </svg>
                    ) : item.kind === "path" ? (
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <rect x="2" y="1" width="8" height="12" rx="1.2" fill="#f1f5f9" stroke="#94a3b8" strokeWidth="0.8"/>
                        <path d="M10 1l2 2v0h-2V1z" fill="#cbd5e1"/>
                        <path d="M10 1l2 2" stroke="#94a3b8" strokeWidth="0.8"/>
                        <line x1="4" y1="5.5" x2="10" y2="5.5" stroke="#cbd5e1" strokeWidth="0.8"/>
                        <line x1="4" y1="7.5" x2="10" y2="7.5" stroke="#cbd5e1" strokeWidth="0.8"/>
                        <line x1="4" y1="9.5" x2="7.5" y2="9.5" stroke="#cbd5e1" strokeWidth="0.8"/>
                      </svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <circle cx="7" cy="7" r="5.5" fill="#d1fae5" stroke="#34d399" strokeWidth="0.9"/>
                        <path d="M4.5 7l1.8 1.8L9.5 5" stroke="#059669" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </span>
                  <span className="composer-suggest-content">
                    <span className="composer-suggest-main">{item.title}</span>
                    {item.desc && <span className="composer-suggest-sub">{item.desc}</span>}
                  </span>
                </button>
              ))
            ) : (
              <div className={`composer-suggest-empty ${suggestError ? "is-error" : ""}`}>
                {suggestError ? `联想失败：${suggestError}` : "无匹配项，按 Enter 可直接发送当前内容"}
              </div>
            )}
          </div>
          <div className="composer-right">
            <button
              type="submit"
              className={`btn-primary composer-send-btn ${isStreaming ? "is-stop" : ""}`}
              disabled={blockingPending}
              aria-label={isStreaming ? "停止" : "发送"}
            >
              {isStreaming ? null : (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M8 13V5" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
                  <path d="M3.5 8.5L8 3.5L12.5 8.5" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </button>
          </div>
        </div>
        <div className="composer-foot">
          <span className="composer-shortcut"><kbd>/</kbd> 快捷指令 · <kbd>@</kbd> 引用文件 · <kbd>Enter</kbd> 发送</span>
          <span className="composer-status">{composerStatus}</span>
        </div>
      </div>
    </form>
  );
}
