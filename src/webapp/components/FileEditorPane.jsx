import { useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { sql } from "@codemirror/lang-sql";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";

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
  const extensions = useMemo(() => languageExtensions(openedFile?.path), [openedFile?.path]);
  if (!openedFile?.path && !fileLoading) return null;

  return (
    <section className="file-editor">
      <header className="file-editor-head">
        <div className="file-editor-meta">
          <strong>{openedFile?.name || "打开文件"}</strong>
          <span>{openedFile?.path || "加载中..."}</span>
          {openedFile?.path && (
            <em>
              {formatSize(openedFile.size)} · {openedFile.dirty ? "未保存" : "已保存"}
            </em>
          )}
        </div>
        <div className="file-editor-actions">
          <button type="button" className="btn-secondary" onClick={onReload} disabled={fileLoading || fileSaving || !openedFile?.path}>
            重新加载
          </button>
          <button type="button" className="btn-primary" onClick={onSave} disabled={fileLoading || fileSaving || !openedFile?.dirty}>
            {fileSaving ? "保存中..." : "保存"}
          </button>
        </div>
      </header>
      {fileError && <p className="file-editor-error">{fileError}</p>}
      <div className="file-editor-body">
        <button
          type="button"
          className="file-editor-close-float"
          onClick={onClose}
          disabled={fileSaving}
          title="关闭文件"
          aria-label="关闭文件"
        >
          ×
        </button>
        {fileLoading ? (
          <div className="file-editor-loading">正在读取文件...</div>
        ) : (
          <CodeMirror
            value={openedFile?.content || ""}
            height="100%"
            onChange={(value) => onChange(value)}
            extensions={extensions}
            basicSetup={{
              lineNumbers: true,
              highlightActiveLine: true,
              foldGutter: true
            }}
          />
        )}
      </div>
    </section>
  );
}
