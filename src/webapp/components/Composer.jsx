export default function Composer({
  blockingPending,
  isStreaming,
  inputText,
  setInputText,
  submitUserMessage,
  stop,
  lastUserText,
  composerToolsOpen,
  setComposerToolsOpen,
  composerMoreOpen,
  setComposerMoreOpen,
  composerToolsRef,
  composerMoreRef,
  textareaRef
}) {
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
  );
}
