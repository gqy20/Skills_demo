import React from "react";

export default function PreflightPanel({ show, quickPrompts, quickChips, onSubmitPrompt, onSelectChip }) {
  if (!show) return null;

  return (
    <section className="empty-state">
      <div className="empty-state-intro">
        <h2>开始你的科研任务</h2>
        <p>先选择任务模板，或在底部输入框补充具体要求后发送。</p>
      </div>
      <div className="empty-actions">
        {quickPrompts.map((item) => (
          <button key={item.title} type="button" className="empty-action-card" onClick={() => onSubmitPrompt(item.text)}>
            <strong>{item.title}</strong>
            <span>{item.text}</span>
            <span className="empty-action-cta">立即开始</span>
          </button>
        ))}
      </div>
      <div className="quick-chip-list">
        {quickChips.map((chip) => (
          <button key={chip} type="button" className="quick-chip" onClick={() => onSelectChip(chip)}>
            {chip}
          </button>
        ))}
      </div>
    </section>
  );
}
