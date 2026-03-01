import React from "react";
import { inspectEnvText, parseEnvText } from "../lib/chatUtils.js";

export default function SettingsModal({
  open,
  settings,
  setSettings,
  mcpCatalog,
  onClose,
  onSave
}) {
  const runtimeEnvStats = React.useMemo(() => inspectEnvText(settings.runtimeEnvText), [settings.runtimeEnvText]);
  const runtimeEnvMap = React.useMemo(() => parseEnvText(settings.runtimeEnvText), [settings.runtimeEnvText]);
  const mcpServers = Array.isArray(mcpCatalog?.items) ? mcpCatalog.items : [];
  const requiredByServer = React.useMemo(
    () =>
      mcpServers
        .map((item) => ({
          name: String(item?.name || "unknown"),
          requiredEnvVars: Array.isArray(item?.requiredEnvVars)
            ? Array.from(new Set(item.requiredEnvVars.filter((k) => typeof k === "string" && k.trim()).map((k) => k.trim())))
            : []
        }))
        .filter((item) => item.requiredEnvVars.length > 0),
    [mcpServers]
  );
  const allRequiredKeys = React.useMemo(
    () => Array.from(new Set(requiredByServer.flatMap((item) => item.requiredEnvVars))),
    [requiredByServer]
  );
  const mcpRequiredSet = React.useMemo(() => new Set(allRequiredKeys), [allRequiredKeys]);
  const mcpPrefixes = React.useMemo(() => {
    const prefixes = new Set(["MCP", "NOTION", "ZOTERO"]);
    for (const key of allRequiredKeys) {
      const prefix = String(key || "")
        .trim()
        .split("_")[0];
      if (prefix) prefixes.add(prefix);
    }
    for (const item of mcpServers) {
      const prefix = String(item?.name || "")
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "_");
      if (prefix) prefixes.add(prefix);
    }
    return Array.from(prefixes);
  }, [allRequiredKeys, mcpServers]);
  const isMcpKey = React.useCallback(
    (key) => {
      const normalized = String(key || "").trim();
      if (!normalized) return false;
      if (mcpRequiredSet.has(normalized)) return true;
      return mcpPrefixes.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}_`));
    },
    [mcpPrefixes, mcpRequiredSet]
  );
  const runtimeEnvSplitText = React.useMemo(() => {
    const map = parseEnvText(settings.runtimeEnvText);
    const mcpPairs = [];
    const otherPairs = [];
    for (const [key, value] of Object.entries(map)) {
      if (isMcpKey(key)) mcpPairs.push([key, value]);
      else otherPairs.push([key, value]);
    }
    return {
      mcpText: mcpPairs.map(([key, value]) => `${key}=${value}`).join("\n"),
      otherText: otherPairs.map(([key, value]) => `${key}=${value}`).join("\n")
    };
  }, [isMcpKey, settings.runtimeEnvText]);
  const missingRequiredKeys = React.useMemo(
    () => allRequiredKeys.filter((key) => !String(runtimeEnvMap[key] || "").trim()),
    [allRequiredKeys, runtimeEnvMap]
  );
  const updateRuntimeEnvPartition = React.useCallback(
    (target, text) => {
      const current = parseEnvText(settings.runtimeEnvText);
      const input = parseEnvText(text);
      const next = {};
      for (const [key, value] of Object.entries(current)) {
        if (target === "mcp" ? !isMcpKey(key) : isMcpKey(key)) next[key] = value;
      }
      for (const [key, value] of Object.entries(input)) {
        if (target === "mcp" ? isMcpKey(key) : !isMcpKey(key)) next[key] = value;
      }
      const nextText = Object.entries(next)
        .map(([key, value]) => `${key}=${value}`)
        .join("\n");
      setSettings((prev) => ({ ...prev, runtimeEnvText: nextText }));
    },
    [isMcpKey, setSettings, settings.runtimeEnvText]
  );
  const upsertMcpEnvKeys = React.useCallback(
    (keys) => {
      const normalized = Array.from(
        new Set(
          (Array.isArray(keys) ? keys : [])
            .map((key) => String(key || "").trim())
            .filter(Boolean)
        )
      );
      if (normalized.length === 0) return;
      setSettings((prev) => {
        const current = parseEnvText(prev.runtimeEnvText);
        for (const key of normalized) {
          if (!Object.prototype.hasOwnProperty.call(current, key)) current[key] = "";
        }
        const nextText = Object.entries(current)
          .map(([key, value]) => `${key}=${value}`)
          .join("\n");
        return { ...prev, runtimeEnvText: nextText };
      });
    },
    [setSettings]
  );
  const snapshotOf = React.useCallback(
    (value) =>
      JSON.stringify({
        model: value?.model || "",
        baseUrl: value?.baseUrl || "",
        authToken: value?.authToken || "",
        runtimeEnvText: value?.runtimeEnvText || "",
        permissionProfile: value?.permissionProfile || "standard",
        toolGateEnabled: value?.toolGateEnabled !== false
      }),
    []
  );
  const openSnapshotRef = React.useRef("");
  const [syncNotice, setSyncNotice] = React.useState({ type: "", message: "" });

  React.useEffect(() => {
    if (open) {
      openSnapshotRef.current = snapshotOf(settings);
      setSyncNotice({ type: "", message: "" });
    }
  }, [open, snapshotOf]);

  const dirty = open && openSnapshotRef.current && snapshotOf(settings) !== openSnapshotRef.current;
  const requestClose = React.useCallback(async () => {
    if (!dirty) {
      onClose();
      return;
    }
    const shouldSave = window.confirm("检测到未保存改动。点击“确定”保存并关闭；点击“取消”继续选择。");
    if (shouldSave) {
      try {
        await onSave(settings);
        onClose();
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        setSyncNotice({ type: "error", message: `保存失败: ${msg}` });
      }
      return;
    }
    const shouldDiscard = window.confirm("确认放弃未保存改动并关闭吗？");
    if (shouldDiscard) onClose();
  }, [dirty, onClose, onSave, settings]);

  return (
    <div
      className={`modal ${open ? "" : "hidden"}`}
      onClick={() => {
        requestClose().catch(() => {});
      }}
    >
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>运行配置</h2>
          <button
            type="button"
            className="modal-close-btn"
            aria-label="关闭设置"
            onClick={() => {
              requestClose().catch(() => {});
            }}
          >
            ×
          </button>
        </div>
        <form
          className="settings-form"
          onSubmit={(event) => {
            event.preventDefault();
          }}
        >
          <div className="settings-section">
            <h3 className="settings-section-title">基础配置</h3>
            <label>模型（ANTHROPIC_MODEL）</label>
            <input value={settings.model} onChange={(e) => setSettings((s) => ({ ...s, model: e.target.value }))} />
            <label>接口地址（ANTHROPIC_BASE_URL）</label>
            <input value={settings.baseUrl} onChange={(e) => setSettings((s) => ({ ...s, baseUrl: e.target.value }))} />
            <label>API Key（ANTHROPIC_AUTH_TOKEN）</label>
            <input
              type="password"
              value={settings.authToken}
              placeholder={settings.hasToken ? `已保存: ${settings.tokenPreview}` : "请输入 API Key"}
              onChange={(e) => setSettings((s) => ({ ...s, authToken: e.target.value }))}
            />
          </div>

          <div className="settings-section">
            <h3 className="settings-section-title">运行时变量</h3>
            <div className="settings-env-grid">
              <div>
                <label>MCP 变量</label>
                <textarea
                  className="settings-textarea"
                  rows={6}
                  value={runtimeEnvSplitText.mcpText}
                  placeholder={"NOTION_TOKEN=\nZOTERO_API_KEY=\nZOTERO_LIBRARY_ID="}
                  spellCheck={false}
                  onChange={(e) => updateRuntimeEnvPartition("mcp", e.target.value)}
                />
              </div>
              <div>
                <label>其他变量</label>
                <textarea
                  className="settings-textarea"
                  rows={6}
                  value={runtimeEnvSplitText.otherText}
                  placeholder={"MINERU_API_KEY=\nCUSTOM_KEY="}
                  spellCheck={false}
                  onChange={(e) => updateRuntimeEnvPartition("other", e.target.value)}
                />
              </div>
            </div>
            <div className="settings-inline-meta">
              <span className="meta-chip">有效项: {runtimeEnvStats.validCount}</span>
              {allRequiredKeys.length > 0 && (
                <span className="meta-chip">MCP 必需: {allRequiredKeys.length}</span>
              )}
              {missingRequiredKeys.length > 0 && (
                <span className="meta-chip warn">待补齐: {missingRequiredKeys.length}</span>
              )}
              {runtimeEnvStats.invalidLineNumbers.length > 0 && (
                <span className="meta-chip warn">无效行: {runtimeEnvStats.invalidLineNumbers.join(", ")}</span>
              )}
              {runtimeEnvStats.duplicateKeys.length > 0 && (
                <span className="meta-chip warn">重复 Key: {Array.from(new Set(runtimeEnvStats.duplicateKeys)).join(", ")}</span>
              )}
            </div>
            {requiredByServer.length > 0 && (
              <div className="settings-mcp-required">
                <div className="settings-mcp-required-head">
                  <p>检测到 .mcp.json 所需环境变量</p>
                  {missingRequiredKeys.length > 0 && (
                    <button type="button" className="sidebar-mini-btn" onClick={() => upsertMcpEnvKeys(missingRequiredKeys)}>
                      补齐全部缺失
                    </button>
                  )}
                </div>
                <ul className="settings-mcp-required-list">
                  {requiredByServer.map((server) => {
                    const serverMissing = server.requiredEnvVars.filter((key) => !String(runtimeEnvMap[key] || "").trim());
                    return (
                      <li key={server.name} className="settings-mcp-required-item">
                        <div className="settings-mcp-required-server">
                          <strong>{server.name}</strong>
                          <span className="meta-chip">
                            {server.requiredEnvVars.length - serverMissing.length}/{server.requiredEnvVars.length} 已配置
                          </span>
                          {serverMissing.length > 0 && (
                            <button type="button" className="sidebar-mini-btn" onClick={() => upsertMcpEnvKeys(serverMissing)}>
                              补齐该服务
                            </button>
                          )}
                        </div>
                        <div className="settings-mcp-required-keys">
                          {server.requiredEnvVars.map((key) => {
                            const filled = Boolean(String(runtimeEnvMap[key] || "").trim());
                            return (
                              <span key={`${server.name}:${key}`} className={`meta-chip ${filled ? "" : "warn"}`}>
                                {key}
                              </span>
                            );
                          })}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>

          <div className="settings-section">
            <h3 className="settings-section-title">权限</h3>
            <label>权限模式</label>
            <select
              value={settings.permissionProfile}
              onChange={(e) => {
                const nextMode = e.target.value;
                setSettings((s) => ({
                  ...s,
                  permissionProfile: nextMode,
                  toolGateEnabled: nextMode === "standard" ? s.toolGateEnabled : false
                }));
              }}
            >
              <option value="standard">标准（按需审批）</option>
              <option value="accept_edits">自动接受编辑</option>
              <option value="full_auto">全部允许（高风险）</option>
            </select>
            {settings.permissionProfile === "full_auto" && (
              <p className="settings-warning">该模式会跳过权限审批，工具可直接执行写文件/命令操作。请仅在可信环境使用。</p>
            )}
            <label>审批开关（仅标准模式）</label>
            <select
              value={settings.toolGateEnabled ? "on" : "off"}
              disabled={settings.permissionProfile !== "standard"}
              onChange={(e) => setSettings((s) => ({ ...s, toolGateEnabled: e.target.value === "on" }))}
            >
              <option value="on">ON</option>
              <option value="off">OFF</option>
            </select>
            <div className="pending-actions">
              {dirty && <span className="meta-chip warn">存在未保存改动</span>}
              {syncNotice.message && (
                <span className={`meta-chip ${syncNotice.type === "error" ? "warn" : ""}`}>{syncNotice.message}</span>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
