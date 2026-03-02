import { useEffect, useMemo, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { sql } from "@codemirror/lang-sql";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import { foldGutter } from "@codemirror/language";

function formatSize(size) {
  const n = Number(size || 0);
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function languageExtensions(filePath) {
  const p = String(filePath || "").toLowerCase();
  if (!p) return [];
  if (p.endsWith(".ts") || p.endsWith(".tsx") || p.endsWith(".js") || p.endsWith(".jsx") || p.endsWith(".mjs") || p.endsWith(".cjs")) {
    return [javascript({ typescript: p.endsWith(".ts") || p.endsWith(".tsx"), jsx: p.endsWith(".tsx") || p.endsWith(".jsx") })];
  }
  if (p.endsWith(".json")) return [json()];
  if (p.endsWith(".md") || p.endsWith(".markdown")) return [markdown()];
  if (p.endsWith(".py")) return [python()];
  if (p.endsWith(".css") || p.endsWith(".scss") || p.endsWith(".less")) return [css()];
  if (p.endsWith(".html") || p.endsWith(".htm")) return [html()];
  if (p.endsWith(".sql")) return [sql()];
  if (p.endsWith(".xml") || p.endsWith(".svg")) return [xml()];
  if (p.endsWith(".yaml") || p.endsWith(".yml")) return [yaml()];
  return [];
}

function foldMarkerDOM(open) {
  const marker = document.createElement("span");
  marker.className = `cm-fold-marker ${open ? "is-open" : "is-closed"}`;
  marker.textContent = "›";
  return marker;
}

function isMarkdownFile(filePath) {
  return /(\.md|\.markdown)$/i.test(String(filePath || ""));
}

function syncScrollByRatio(from, to) {
  if (!from || !to) return;
  const fromRange = from.scrollHeight - from.clientHeight;
  const toRange = to.scrollHeight - to.clientHeight;
  if (fromRange <= 0 || toRange <= 0) {
    to.scrollTop = 0;
    return;
  }
  const ratio = from.scrollTop / fromRange;
  to.scrollTop = ratio * toRange;
}

function getPrimaryScrollElement(editorRoot) {
  if (!editorRoot) return null;
  const candidates = [editorRoot.querySelector(".cm-scroller"), editorRoot.querySelector(".cm-editor"), editorRoot].filter(Boolean);
  let best = candidates[0] || null;
  let bestOverflow = -1;
  for (const element of candidates) {
    const overflow = element.scrollHeight - element.clientHeight;
    if (overflow > bestOverflow) {
      bestOverflow = overflow;
      best = element;
    }
  }
  return best;
}

export default function FileEditorPane({
  openedFile,
  fileLoading,
  fileSaving,
  fileError,
  onChange,
  onSave,
  onReload,
  onClose
}) {
  const [viewMode, setViewMode] = useState("split");
  const editorWrapRef = useRef(null);
  const previewPaneRef = useRef(null);
  const markdownFile = isMarkdownFile(openedFile?.path);
  const extensions = useMemo(
    () => [
      foldGutter({
        markerDOM: foldMarkerDOM
      }),
      ...languageExtensions(openedFile?.path)
    ],
    [openedFile?.path]
  );

  useEffect(() => {
    setViewMode(markdownFile ? "split" : "code");
  }, [markdownFile, openedFile?.path]);

  useEffect(() => {
    if (!markdownFile || viewMode !== "split") return undefined;
    const editorScroller = getPrimaryScrollElement(editorWrapRef.current);
    const previewScroller = previewPaneRef.current;
    if (!editorScroller || !previewScroller) return undefined;

    let lock = "";
    let rafId = 0;
    const releaseLock = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        lock = "";
      });
    };

    const syncFromEditor = () => {
      if (lock === "preview") return;
      lock = "editor";
      syncScrollByRatio(editorScroller, previewScroller);
      releaseLock();
    };

    const syncFromPreview = () => {
      if (lock === "editor") return;
      lock = "preview";
      syncScrollByRatio(previewScroller, editorScroller);
      releaseLock();
    };

    editorScroller.addEventListener("scroll", syncFromEditor, { passive: true });
    previewScroller.addEventListener("scroll", syncFromPreview, { passive: true });
    syncScrollByRatio(editorScroller, previewScroller);

    const resizeObserver = new ResizeObserver(() => {
      syncScrollByRatio(editorScroller, previewScroller);
    });
    resizeObserver.observe(editorScroller);
    resizeObserver.observe(previewScroller);

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      editorScroller.removeEventListener("scroll", syncFromEditor);
      previewScroller.removeEventListener("scroll", syncFromPreview);
    };
  }, [markdownFile, viewMode, openedFile?.path, openedFile?.content]);

  if (!openedFile?.path && !fileLoading) return null;
  const dirty = openedFile?.dirty === true;
  const canPreview = markdownFile && !fileLoading;
  const activeMode = markdownFile ? viewMode : "code";

  const renderEditor = () => (
    <div ref={editorWrapRef} className="file-editor-cm-wrap">
      <CodeMirror
        value={openedFile?.content || ""}
        height="100%"
        onChange={(value) => onChange(value)}
        extensions={extensions}
        basicSetup={{
          lineNumbers: true,
          highlightActiveLine: true,
          foldGutter: false
        }}
      />
    </div>
  );

  const renderMarkdownPreview = () => (
    <section ref={previewPaneRef} className="md-preview-pane" aria-label="Markdown 预览">
      <article className="md-preview-content">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{openedFile?.content || ""}</ReactMarkdown>
      </article>
    </section>
  );

  return (
    <section className="file-editor">
      <header className="file-editor-head">
        <div className="file-editor-meta-main">
          <div className="file-editor-title-row">
            <strong>{openedFile?.path || openedFile?.name || "打开文件"}</strong>
            {openedFile?.path && (
              <span className={`file-status-chip ${dirty ? "is-dirty" : "is-clean"}`}>
                {dirty ? "未保存" : "已保存"}
              </span>
            )}
          </div>
          {openedFile?.path && <em>{formatSize(openedFile.size)}</em>}
        </div>
        <div className="file-editor-actions">
          {canPreview && (
            <div className="file-editor-view-toggle" role="tablist" aria-label="Markdown 视图模式">
              <button
                type="button"
                className={`sidebar-mini-btn ${activeMode === "code" ? "is-primary" : ""}`}
                onClick={() => setViewMode("code")}
              >
                编辑
              </button>
              <button
                type="button"
                className={`sidebar-mini-btn ${activeMode === "preview" ? "is-primary" : ""}`}
                onClick={() => setViewMode("preview")}
              >
                预览
              </button>
              <button
                type="button"
                className={`sidebar-mini-btn ${activeMode === "split" ? "is-primary" : ""}`}
                onClick={() => setViewMode("split")}
              >
                分栏
              </button>
            </div>
          )}
          <button type="button" className="btn-secondary" onClick={onReload} disabled={fileLoading || fileSaving || !openedFile?.path}>
            重新加载
          </button>
          <button type="button" className="btn-primary" onClick={onSave} disabled={fileLoading || fileSaving || !openedFile?.dirty}>
            {fileSaving ? "保存中..." : "保存"}
          </button>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={fileSaving} title="关闭文件" aria-label="关闭文件">
            关闭
          </button>
        </div>
      </header>
      {fileError && <p className="file-editor-error">{fileError}</p>}
      <div className="file-editor-body">
        {fileLoading ? (
          <div className="file-editor-loading">正在读取文件...</div>
        ) : activeMode === "preview" ? (
          renderMarkdownPreview()
        ) : activeMode === "split" ? (
          <div className="file-editor-split">
            {renderEditor()}
            {renderMarkdownPreview()}
          </div>
        ) : (
          renderEditor()
        )}
      </div>
    </section>
  );
}
