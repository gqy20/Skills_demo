import React from "react";
import { inspectEnvText, parseEnvText } from "../lib/chatUtils.js";

const BUSINESS_ENV_KEYS = ["MINERU_API_KEY", "PDF_ENABLE_PARALLEL", "PDF_MAX_WORKERS"];
const BUSINESS_ENV_PREFIXES = ["MINERU", "PDF"];
const CODING_PLAN_META_KEY = "AGENT_WEB_CODING_PLANS_META";
const CODING_PLAN_ACTIVE_KEY = "AGENT_WEB_ACTIVE_CODING_PLAN";
const CODING_PLAN_TOKENS_KEY = "AGENT_WEB_CODING_PLANS_TOKENS";
const CODING_PLAN_PRESETS = [
  {
    key: "minimax",
    label: "MiniMax",
    planNamePrefix: "MiniMax",
    envKey: "ANTHROPIC_BASE_URL",
    baseUrl: "https://api.minimaxi.com/anthropic",
    model: "MiniMax-M2.5",
    models: ["MiniMax-M2.5", "MiniMax-M2.5-highspeed", "MiniMax-M2.1", "MiniMax-M2.1-highspeed", "MiniMax-M2"]
  },
  {
    key: "zhipu",
    label: "智谱 (Zhipu)",
    planNamePrefix: "Zhipu",
    envKey: "ANTHROPIC_BASE_URL",
    baseUrl: "https://open.bigmodel.cn/api/anthropic",
    model: "glm-5",
    models: ["glm-5", "glm-4.7", "glm-4.5-air", "glm-4.5-flash"]
  },
  {
    key: "dashscope",
    label: "阿里云百炼",
    planNamePrefix: "DashScope",
    envKey: "ANTHROPIC_BASE_URL",
    baseUrl: "https://coding.dashscope.aliyuncs.com/apps/anthropic",
    model: "qwen3.5-plus",
    models: ["qwen3.5-plus", "kimi-k2.5", "glm-5", "MiniMax-M2.5"]
  },
  {
    key: "volc-anthropic",
    label: "火山方舟",
    planNamePrefix: "Volc",
    envKey: "ANTHROPIC_BASE_URL",
    baseUrl: "https://ark.cn-beijing.volces.com/api/coding",
    model: "Doubao-Seed-Code",
    models: ["Doubao-Seed-Code", "DeepSeek-V3.2", "Kimi-K2.5", "Kimi-K2", "GLM-4.7"]
  }
];

function parseCodingPlans(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        const id = String(item?.id || "").trim();
        const name = String(item?.name || "").trim();
        const baseUrl = String(item?.baseUrl || "").trim();
        const model = String(item?.model || "").trim();
        if (!id || !name || !baseUrl || !model) return null;
        return { id, name, baseUrl, model };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function parseCodingPlanTokens(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out = {};
    for (const [id, token] of Object.entries(parsed)) {
      const key = String(id || "").trim();
      const value = String(token || "").trim();
      if (key && value) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function stringifyEnvMap(map) {
  return Object.entries(map)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

function nextPlanName(plans, prefix = "Plan") {
  const normalizedPrefix = String(prefix || "Plan").trim() || "Plan";
  const names = (Array.isArray(plans) ? plans : []).map((item) => String(item?.name || "").trim());
  let maxIndex = 0;
  for (const name of names) {
    if (!name.startsWith(normalizedPrefix)) continue;
    const suffix = name.slice(normalizedPrefix.length);
    const num = Number.parseInt(suffix, 10);
    if (Number.isFinite(num) && num > maxIndex) maxIndex = num;
  }
  return `${normalizedPrefix}${maxIndex + 1}`;
}

function maskTokenPreview(token) {
  const raw = String(token || "").trim();
  if (!raw) return "";
  if (raw.length <= 6) return `${raw[0] || "*"}***${raw[raw.length - 1] || "*"}`;
  return `${raw.slice(0, 3)}...${raw.slice(-3)}`;
}

function isPlanInternalKey(key) {
  return key === CODING_PLAN_META_KEY || key === CODING_PLAN_ACTIVE_KEY || key === CODING_PLAN_TOKENS_KEY;
}

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
  const [onlyShowMissing, setOnlyShowMissing] = React.useState(false);
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
  const businessRequiredSet = React.useMemo(() => new Set(BUSINESS_ENV_KEYS), []);
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
  const isBusinessKey = React.useCallback(
    (key) => {
      const normalized = String(key || "").trim();
      if (!normalized) return false;
      if (isMcpKey(normalized)) return false;
      if (businessRequiredSet.has(normalized)) return true;
      return BUSINESS_ENV_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}_`));
    },
    [businessRequiredSet, isMcpKey]
  );
  const runtimeEnvSplitText = React.useMemo(() => {
    const map = parseEnvText(settings.runtimeEnvText);
    const mcpPairs = [];
    const businessPairs = [];
    const otherPairs = [];
    for (const [key, value] of Object.entries(map)) {
      if (isPlanInternalKey(key)) continue;
      if (isMcpKey(key)) mcpPairs.push([key, value]);
      else if (isBusinessKey(key)) businessPairs.push([key, value]);
      else otherPairs.push([key, value]);
    }
    return {
      mcpText: mcpPairs.map(([key, value]) => `${key}=${value}`).join("\n"),
      businessText: businessPairs.map(([key, value]) => `${key}=${value}`).join("\n"),
      otherText: otherPairs.map(([key, value]) => `${key}=${value}`).join("\n")
    };
  }, [isBusinessKey, isMcpKey, settings.runtimeEnvText]);
  const missingRequiredKeys = React.useMemo(
    () => allRequiredKeys.filter((key) => !String(runtimeEnvMap[key] || "").trim()),
    [allRequiredKeys, runtimeEnvMap]
  );
  const missingBusinessKeys = React.useMemo(
    () => BUSINESS_ENV_KEYS.filter((key) => !String(runtimeEnvMap[key] || "").trim()),
    [runtimeEnvMap]
  );
  const updateRuntimeEnvPartition = React.useCallback(
    (target, text) => {
      const current = parseEnvText(settings.runtimeEnvText);
      const input = parseEnvText(text);
      const next = {};
      for (const [key, value] of Object.entries(current)) {
        if (isPlanInternalKey(key)) {
          next[key] = value;
          continue;
        }
        if (
          target === "mcp"
            ? !isMcpKey(key)
            : target === "business"
              ? !isBusinessKey(key)
              : isMcpKey(key) || isBusinessKey(key)
        ) {
          next[key] = value;
        }
      }
      for (const [key, value] of Object.entries(input)) {
        if (isPlanInternalKey(key)) continue;
        if (
          target === "mcp"
            ? isMcpKey(key)
            : target === "business"
              ? isBusinessKey(key)
              : !isMcpKey(key) && !isBusinessKey(key)
        ) {
          next[key] = value;
        }
      }
      const nextText = Object.entries(next)
        .map(([key, value]) => `${key}=${value}`)
        .join("\n");
      setSettings((prev) => ({ ...prev, runtimeEnvText: nextText }));
    },
    [isBusinessKey, isMcpKey, setSettings, settings.runtimeEnvText]
  );
  const upsertEnvKeys = React.useCallback(
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
  const filteredRequiredByServer = React.useMemo(() => {
    if (!onlyShowMissing) return requiredByServer;
    return requiredByServer
      .map((server) => ({
        ...server,
        requiredEnvVars: server.requiredEnvVars.filter((key) => !String(runtimeEnvMap[key] || "").trim())
      }))
      .filter((server) => server.requiredEnvVars.length > 0);
  }, [onlyShowMissing, requiredByServer, runtimeEnvMap]);
  const businessRequiredKeysShown = React.useMemo(
    () => (onlyShowMissing ? missingBusinessKeys : BUSINESS_ENV_KEYS),
    [missingBusinessKeys, onlyShowMissing]
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
  const activePreset = React.useMemo(
    () => CODING_PLAN_PRESETS.find((item) => item.baseUrl === String(settings.baseUrl || "").trim()) || null,
    [settings.baseUrl]
  );
  const suggestedModels = React.useMemo(() => {
    if (activePreset?.models?.length) return activePreset.models;
    return Array.from(new Set(CODING_PLAN_PRESETS.flatMap((item) => item.models || [])));
  }, [activePreset]);
  const modelMatchesPreset = React.useMemo(
    () => suggestedModels.includes(String(settings.model || "").trim()),
    [settings.model, suggestedModels]
  );
  const savedPlans = React.useMemo(() => parseCodingPlans(runtimeEnvMap[CODING_PLAN_META_KEY]), [runtimeEnvMap]);
  const activePlanId = String(runtimeEnvMap[CODING_PLAN_ACTIVE_KEY] || "").trim();
  const planTokens = React.useMemo(() => parseCodingPlanTokens(runtimeEnvMap[CODING_PLAN_TOKENS_KEY]), [runtimeEnvMap]);
  const selectedPlan = React.useMemo(
    () => savedPlans.find((plan) => plan.id === activePlanId) || null,
    [activePlanId, savedPlans]
  );
  const activeTokenPreview = React.useMemo(() => maskTokenPreview(settings.authToken), [settings.authToken]);

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

  const handleAuthTokenChange = React.useCallback(
    (nextTokenRaw) => {
      setSettings((prev) => {
        const nextToken = String(nextTokenRaw || "");
        if (!activePlanId) {
          return { ...prev, authToken: nextToken };
        }
        const envMap = parseEnvText(prev.runtimeEnvText);
        const tokens = parseCodingPlanTokens(envMap[CODING_PLAN_TOKENS_KEY]);
        const normalized = nextToken.trim();
        if (normalized) tokens[activePlanId] = normalized;
        else delete tokens[activePlanId];
        if (Object.keys(tokens).length > 0) envMap[CODING_PLAN_TOKENS_KEY] = JSON.stringify(tokens);
        else delete envMap[CODING_PLAN_TOKENS_KEY];
        return {
          ...prev,
          authToken: nextToken,
          runtimeEnvText: stringifyEnvMap(envMap)
        };
      });
    },
    [activePlanId, setSettings]
  );

  const updatePlanMeta = React.useCallback(
    (updater) => {
      setSettings((prev) => {
        const envMap = parseEnvText(prev.runtimeEnvText);
        const plans = parseCodingPlans(envMap[CODING_PLAN_META_KEY]);
        const activeId = String(envMap[CODING_PLAN_ACTIVE_KEY] || "").trim();
        const tokens = parseCodingPlanTokens(envMap[CODING_PLAN_TOKENS_KEY]);
        const nextState = updater({ plans, activeId, tokens, settings: prev });
        if (!nextState || !Array.isArray(nextState.plans)) return prev;

        const sanitizedPlans = nextState.plans
          .map((plan) => ({
            id: String(plan?.id || "").trim(),
            name: String(plan?.name || "").trim(),
            baseUrl: String(plan?.baseUrl || "").trim(),
            model: String(plan?.model || "").trim()
          }))
          .filter((plan) => plan.id && plan.name && plan.baseUrl && plan.model);

        if (sanitizedPlans.length > 0) envMap[CODING_PLAN_META_KEY] = JSON.stringify(sanitizedPlans);
        else delete envMap[CODING_PLAN_META_KEY];

        const tokenMapRaw = nextState.tokens && typeof nextState.tokens === "object" ? nextState.tokens : {};
        const validIds = new Set(sanitizedPlans.map((plan) => plan.id));
        const nextTokens = {};
        for (const [id, token] of Object.entries(tokenMapRaw)) {
          const key = String(id || "").trim();
          const value = String(token || "").trim();
          if (!key || !value || !validIds.has(key)) continue;
          nextTokens[key] = value;
        }
        if (Object.keys(nextTokens).length > 0) envMap[CODING_PLAN_TOKENS_KEY] = JSON.stringify(nextTokens);
        else delete envMap[CODING_PLAN_TOKENS_KEY];

        const nextActiveId = String(nextState.activeId || "").trim();
        if (nextActiveId && sanitizedPlans.some((plan) => plan.id === nextActiveId)) envMap[CODING_PLAN_ACTIVE_KEY] = nextActiveId;
        else delete envMap[CODING_PLAN_ACTIVE_KEY];

        const activePlan = sanitizedPlans.find((plan) => plan.id === nextActiveId) || null;
        const activePlanToken = nextActiveId ? nextTokens[nextActiveId] || "" : "";
        return {
          ...prev,
          model: activePlan?.model || prev.model,
          baseUrl: activePlan?.baseUrl || prev.baseUrl,
          authToken: activePlan ? activePlanToken : prev.authToken,
          runtimeEnvText: stringifyEnvMap(envMap)
        };
      });
    },
    [setSettings]
  );

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
            <label>Coding Plan 预设</label>
            <select
              value={activePreset?.key || "custom"}
              onChange={(e) => {
                const preset = CODING_PLAN_PRESETS.find((item) => item.key === e.target.value);
                if (!preset) return;
                setSettings((prev) => ({
                  ...prev,
                  baseUrl: preset.baseUrl,
                  model: preset.model || prev.model
                }));
                if (syncNotice.type === "hint") {
                  setSyncNotice({ type: "", message: "" });
                }
              }}
            >
              <option value="custom">自定义（手动填写）</option>
              {CODING_PLAN_PRESETS.map((preset) => (
                <option key={preset.key} value={preset.key}>
                  {preset.label} · {preset.model}
                </option>
              ))}
            </select>
            <p className="settings-hint">选择预设后会自动填充基础参数。</p>
            <div className="settings-plan-row">
              <select
                value={selectedPlan?.id || ""}
                onChange={(e) => {
                  const nextId = String(e.target.value || "");
                  updatePlanMeta(({ plans, tokens }) => ({ plans, tokens, activeId: nextId }));
                }}
              >
                <option value="">未启用保存方案</option>
                {savedPlans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name} · {plan.model}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="sidebar-mini-btn"
                onClick={() => {
                  updatePlanMeta(({ plans }) => {
                    const id = `plan_${Date.now()}`;
                    const prefix = activePreset?.planNamePrefix || "Plan";
                    const nextPlans = [
                      ...plans,
                      { id, name: nextPlanName(plans, prefix), baseUrl: settings.baseUrl, model: settings.model }
                    ];
                    return { plans: nextPlans, tokens: { ...planTokens, [id]: settings.authToken || "" }, activeId: id };
                  });
                }}
              >
                保存为新方案
              </button>
              <button
                type="button"
                className="sidebar-mini-btn"
                disabled={!selectedPlan}
                onClick={() => {
                  if (!selectedPlan) return;
                  updatePlanMeta(({ plans, activeId, tokens }) => ({
                    plans: plans.map((plan) =>
                      plan.id === activeId ? { ...plan, baseUrl: settings.baseUrl, model: settings.model } : plan
                    ),
                    tokens: { ...tokens, [activeId]: settings.authToken || "" },
                    activeId
                  }));
                }}
              >
                覆盖
              </button>
              <button
                type="button"
                className="sidebar-mini-btn"
                disabled={!selectedPlan}
                onClick={() => {
                  if (!selectedPlan) return;
                  updatePlanMeta(({ plans, activeId, tokens }) => {
                    const nextPlans = plans.filter((plan) => plan.id !== activeId);
                    const nextTokens = { ...tokens };
                    delete nextTokens[activeId];
                    return { plans: nextPlans, tokens: nextTokens, activeId: nextPlans[0]?.id || "" };
                  });
                }}
              >
                删除
              </button>
            </div>
            {selectedPlan && (
              <input
                value={selectedPlan.name}
                onChange={(e) => {
                  const nextName = String(e.target.value || "").trim();
                  if (!nextName) return;
                  updatePlanMeta(({ plans, activeId, tokens }) => ({
                    plans: plans.map((plan) => (plan.id === activeId ? { ...plan, name: nextName } : plan)),
                    tokens,
                    activeId
                  }));
                }}
                placeholder="方案名称"
              />
            )}
            <label>模型</label>
            <div className="settings-model-pills">
              {suggestedModels.map((modelId) => (
                <button
                  key={modelId}
                  type="button"
                  className={`settings-model-pill ${settings.model === modelId ? "is-active" : ""}`}
                  onClick={() => setSettings((s) => ({ ...s, model: modelId }))}
                >
                  {modelId}
                </button>
              ))}
              <button
                type="button"
                className={`settings-model-pill ${modelMatchesPreset ? "" : "is-active"}`}
                onClick={() => {
                  if (modelMatchesPreset) setSettings((s) => ({ ...s, model: "" }));
                }}
              >
                自定义
              </button>
            </div>
            {!modelMatchesPreset && (
              <input
                value={settings.model}
                onChange={(e) => setSettings((s) => ({ ...s, model: e.target.value }))}
                placeholder="输入模型名称（与平台配置一致）"
              />
            )}
            {activePreset?.key === "volc-anthropic" && (
              <p className="settings-hint">火山方舟请填写控制台中的模型接入点名称（与方舟控制台配置保持一致）。</p>
            )}
            <label>接口地址</label>
            <input value={settings.baseUrl} onChange={(e) => setSettings((s) => ({ ...s, baseUrl: e.target.value }))} />
            <label>API Key</label>
            {activeTokenPreview && (
              <p className="settings-hint settings-key-preview">
                当前密钥: <code>{activeTokenPreview}</code>
              </p>
            )}
            <input
              type="password"
              value={settings.authToken}
              placeholder={settings.hasToken ? `已保存: ${settings.tokenPreview}` : "请输入 API Key"}
              onChange={(e) => handleAuthTokenChange(e.target.value)}
            />
            <p className="settings-hint">方案已支持独立密钥；切换方案会自动切换对应密钥。</p>
          </div>

          <div className="settings-section">
            <h3 className="settings-section-title">运行时变量</h3>
            <div className="settings-inline-meta">
              <span className="meta-chip">有效项: {runtimeEnvStats.validCount}</span>
              {allRequiredKeys.length > 0 && (
                <span className="meta-chip">MCP 必需: {allRequiredKeys.length}</span>
              )}
              <span className="meta-chip">业务必需: {BUSINESS_ENV_KEYS.length}</span>
              {missingRequiredKeys.length > 0 && (
                <span className="meta-chip warn">待补齐: {missingRequiredKeys.length}</span>
              )}
              {missingBusinessKeys.length > 0 && (
                <span className="meta-chip warn">业务待补齐: {missingBusinessKeys.length}</span>
              )}
              {runtimeEnvStats.invalidLineNumbers.length > 0 && (
                <span className="meta-chip warn">无效行: {runtimeEnvStats.invalidLineNumbers.join(", ")}</span>
              )}
              {runtimeEnvStats.duplicateKeys.length > 0 && (
                <span className="meta-chip warn">重复 Key: {Array.from(new Set(runtimeEnvStats.duplicateKeys)).join(", ")}</span>
              )}
              <button type="button" className={`sidebar-mini-btn ${onlyShowMissing ? "is-primary" : ""}`} onClick={() => setOnlyShowMissing((v) => !v)}>
                {onlyShowMissing ? "显示全部" : "只看缺失"}
              </button>
            </div>
            <div className="settings-mcp-required">
              <div className="settings-mcp-required-head">
                <p>检测到 .mcp.json 所需环境变量</p>
                {missingRequiredKeys.length > 0 && (
                  <button type="button" className="sidebar-mini-btn" onClick={() => upsertEnvKeys(missingRequiredKeys)}>
                    补齐全部缺失
                  </button>
                )}
              </div>
              <ul className="settings-mcp-required-list">
                {filteredRequiredByServer.map((server) => {
                  const serverMissing = server.requiredEnvVars.filter((key) => !String(runtimeEnvMap[key] || "").trim());
                  return (
                    <li key={server.name} className="settings-mcp-required-item">
                      <div className="settings-mcp-required-server">
                        <strong>{server.name}</strong>
                        <span className="meta-chip">
                          {server.requiredEnvVars.length - serverMissing.length}/{server.requiredEnvVars.length} 已配置
                        </span>
                        {serverMissing.length > 0 && (
                          <button type="button" className="sidebar-mini-btn" onClick={() => upsertEnvKeys(serverMissing)}>
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
                {requiredByServer.length === 0 && <li className="sessions-empty">未检测到 MCP 必需变量</li>}
                {requiredByServer.length > 0 && filteredRequiredByServer.length === 0 && <li className="sessions-empty">当前筛选下无缺失项</li>}
              </ul>
              <label>MCP 变量（可直接修改）</label>
              <textarea
                className="settings-textarea settings-required-editor"
                rows={5}
                value={runtimeEnvSplitText.mcpText}
                placeholder={"NOTION_TOKEN=\nZOTERO_API_KEY=\nZOTERO_LIBRARY_ID="}
                spellCheck={false}
                onChange={(e) => updateRuntimeEnvPartition("mcp", e.target.value)}
              />
            </div>
            <div className="settings-mcp-required">
              <div className="settings-mcp-required-head">
                <p>业务必需变量</p>
                {missingBusinessKeys.length > 0 && (
                  <button type="button" className="sidebar-mini-btn" onClick={() => upsertEnvKeys(missingBusinessKeys)}>
                    补齐业务缺失
                  </button>
                )}
              </div>
              <div className="settings-mcp-required-keys">
                {businessRequiredKeysShown.map((key) => {
                  const filled = Boolean(String(runtimeEnvMap[key] || "").trim());
                  return (
                    <span key={`biz:${key}`} className={`meta-chip ${filled ? "" : "warn"}`}>
                      {key}
                    </span>
                  );
                })}
                {businessRequiredKeysShown.length === 0 && <span className="sessions-empty">当前筛选下无缺失项</span>}
              </div>
              <label>业务变量（可直接修改）</label>
              <textarea
                className="settings-textarea settings-required-editor"
                rows={5}
                value={runtimeEnvSplitText.businessText}
                placeholder={"MINERU_API_KEY=\nPDF_ENABLE_PARALLEL=\nPDF_MAX_WORKERS="}
                spellCheck={false}
                onChange={(e) => updateRuntimeEnvPartition("business", e.target.value)}
              />
            </div>
            <div className="settings-mcp-required">
              <div className="settings-mcp-required-head">
                <p>其他变量</p>
              </div>
              <textarea
                className="settings-textarea settings-required-editor"
                rows={5}
                value={runtimeEnvSplitText.otherText}
                placeholder={"CUSTOM_KEY=\nANOTHER_KEY="}
                spellCheck={false}
                onChange={(e) => updateRuntimeEnvPartition("other", e.target.value)}
              />
            </div>
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
