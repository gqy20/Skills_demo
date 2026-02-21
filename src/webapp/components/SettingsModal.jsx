import React from "react";
import { permissionProfileLabel } from "../lib/chatUtils.js";

export default function SettingsModal({
  open,
  settings,
  setSettings,
  dangerConfirmText,
  setDangerConfirmText,
  onClose,
  onSave
}) {
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
          <label>ANTHROPIC_MODEL</label>
          <input value={settings.model} onChange={(e) => setSettings((s) => ({ ...s, model: e.target.value }))} />
          <label>ANTHROPIC_BASE_URL</label>
          <input value={settings.baseUrl} onChange={(e) => setSettings((s) => ({ ...s, baseUrl: e.target.value }))} />
          <label>ANTHROPIC_AUTH_TOKEN (API Key)</label>
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
        </form>
      </div>
    </div>
  );
}
