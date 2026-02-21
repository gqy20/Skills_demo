import React from "react";

export default function UsageStrip({
  skillUsageList,
  mcpUsageList,
  usagePanelOpen,
  usageExpanded,
  setUsagePanelOpen,
  setUsageExpanded
}) {
  if (skillUsageList.length === 0 && mcpUsageList.length === 0) return null;

  return (
    <section className="usage-strip">
      <div className="usage-strip-head">
        <strong>运行摘要</strong>
        <button type="button" className="activity-toggle" onClick={() => setUsagePanelOpen((v) => !v)}>
          {usagePanelOpen ? "收起" : "展开"}
        </button>
      </div>
      {usagePanelOpen && (
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
      )}
    </section>
  );
}
