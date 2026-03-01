import React from "react";
import { inspectEnvText, parseEnvText, permissionProfileLabel } from "../lib/chatUtils.js";

export default function SettingsModal({
  open,
  settings,
  setSettings,
  mcpCatalog,
  dangerConfirmText,
  setDangerConfirmText,
  envSyncConfirmText,
  setEnvSyncConfirmText,
  onClose,
  onSave,
  onSyncDotenv
}) {
  const mcpEnvStats = React.useMemo(() => inspectEnvText(settings.mcpEnvText), [settings.mcpEnvText]);
  const mcpEnvMap = React.useMemo(() => parseEnvText(settings.mcpEnvText), [settings.mcpEnvText]);
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
  const missingRequiredKeys = React.useMemo(
    () => allRequiredKeys.filter((key) => !String(mcpEnvMap[key] || "").trim()),
    [allRequiredKeys, mcpEnvMap]
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
        const current = parseEnvText(prev.mcpEnvText);
        for (const key of normalized) {
          if (!Object.prototype.hasOwnProperty.call(current, key)) current[key] = "";
        }
        const nextText = Object.entries(current)
          .map(([key, value]) => `${key}=${value}`)
          .join("\n");
        return { ...prev, mcpEnvText: nextText };
      });
    },
    [setSettings]
  );

  return (
    <div
      className={`modal ${open ? "" : "hidden"}`}
      onClick={() => {
        onClose();
      }}
    >
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>运行配置</h2>
          <button
            className="btn-secondary"
            type="button"
            onClick={() => {
              onClose();
            }}
          >
            关闭
          </button>
        </div>
        <form
          className="settings-form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (settings.permissionProfile === "full_auto" && dangerConfirmText.trim() !== "I UNDERSTAND") {
              window.alert("启用“全部允许”前，请输入 I UNDERSTAND 进行确认。");
              return;
            }
            await onSave(settings);
            setDangerConfirmText("");
            onClose();
          }}
        >
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
          <label>MINERU_API_KEY</label>
          <input
            type="password"
            value={settings.mineruApiKey}
            placeholder={settings.hasMineruKey ? `已保存: ${settings.mineruKeyPreview}` : "请输入 MinerU API Key"}
            onChange={(e) => setSettings((s) => ({ ...s, mineruApiKey: e.target.value }))}
          />
          <label>MCP 环境变量</label>
          <p className="settings-hint">每行一个 `KEY=VALUE`，支持 `#` 注释。保存时将按当前文本全量覆盖 MCP 变量。</p>
          <textarea
            className="settings-textarea"
            rows={6}
            value={settings.mcpEnvText}
            placeholder={"NOTION_TOKEN=ntn_xxx\nZOTERO_API_KEY=xxx\nZOTERO_LIBRARY_ID=123456"}
            spellCheck={false}
            onChange={(e) => setSettings((s) => ({ ...s, mcpEnvText: e.target.value }))}
          />
          <div className="settings-inline-meta">
            <span className="meta-chip">有效项: {mcpEnvStats.validCount}</span>
            {allRequiredKeys.length > 0 && (
              <span className="meta-chip">MCP 必需: {allRequiredKeys.length}</span>
            )}
            {missingRequiredKeys.length > 0 && (
              <span className="meta-chip warn">待补齐: {missingRequiredKeys.length}</span>
            )}
            {mcpEnvStats.invalidLineNumbers.length > 0 && (
              <span className="meta-chip warn">无效行: {mcpEnvStats.invalidLineNumbers.join(", ")}</span>
            )}
            {mcpEnvStats.duplicateKeys.length > 0 && (
              <span className="meta-chip warn">重复 Key: {Array.from(new Set(mcpEnvStats.duplicateKeys)).join(", ")}</span>
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
                  const serverMissing = server.requiredEnvVars.filter((key) => !String(mcpEnvMap[key] || "").trim());
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
                          const filled = Boolean(String(mcpEnvMap[key] || "").trim());
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
              if (nextMode !== "full_auto") setDangerConfirmText("");
            }}
          >
            <option value="standard">标准（按需审批）</option>
            <option value="accept_edits">自动接受编辑</option>
            <option value="full_auto">全部允许（高风险）</option>
          </select>
          {settings.permissionProfile === "full_auto" && (
            <>
              <p className="settings-warning">该模式会跳过权限审批，工具可直接执行写文件/命令操作。请仅在可信环境使用。</p>
              <label>输入 I UNDERSTAND 以确认</label>
              <input value={dangerConfirmText} onChange={(e) => setDangerConfirmText(e.target.value)} placeholder="I UNDERSTAND" />
            </>
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
            <button type="submit">保存配置</button>
            <span className="meta-chip">权限: {permissionProfileLabel(settings.permissionProfile)}</span>
          </div>
          <label>同步到 .env（手动确认）</label>
          <p className="settings-hint">
            请输入 <code>SYNC .ENV</code> 后点击同步。该操作会把当前模型/API Key/MCP 环境变量写入工作区根目录的 <code>.env</code>。
          </p>
          <input
            value={envSyncConfirmText}
            onChange={(e) => setEnvSyncConfirmText(e.target.value)}
            placeholder="SYNC .ENV"
          />
          <div className="pending-actions">
            <button
              type="button"
              onClick={async () => {
                try {
                  await onSyncDotenv(envSyncConfirmText);
                  window.alert("已同步到 .env");
                } catch (error) {
                  const msg = error instanceof Error ? error.message : String(error);
                  window.alert(`同步失败: ${msg}`);
                }
              }}
            >
              同步当前配置到 .env
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
