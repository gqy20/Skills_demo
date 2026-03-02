import React from "react";

export default function PreflightPanel({ show, quickPrompts, onSubmitPrompt }) {
  if (!show) return null;

  return (
    <section className="empty-state">
      <div className="empty-state-intro">
        <h2>有什么可以帮你研究的？</h2>
        <p>选择下方模板快速开始，或直接在输入框描述你的需求。</p>
      </div>
      <div className="empty-actions">
        {quickPrompts.map((item, i) => (
          <button
            key={item.title}
            type="button"
            className="empty-action-card"
            style={{ animationDelay: `${i * 60}ms` }}
            onClick={() => onSubmitPrompt(item.text)}
          >
            <span className="empty-action-icon">{item.icon}</span>
            <div className="empty-action-body">
              <strong>{item.title}</strong>
              <span>{item.desc}</span>
            </div>
            <span className="empty-action-cta">开始 →</span>
          </button>
        ))}
      </div>
    </section>
  );
}
