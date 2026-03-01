export function textFromMessage(message) {
  if (!Array.isArray(message?.parts)) return "";
  return message.parts
    .filter((part) => part?.type === "text" && typeof part?.text === "string")
    .map((part) => part.text)
    .join("");
}

export function parseError(error) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    if (typeof error.error === "string") return error.error;
    if (typeof error.message === "string") return error.message;
  }
  return String(error);
}

export function parseEnvText(text) {
  const out = {};
  const lines = String(text || "").split(/\r?\n/);
  for (const line of lines) {
    const raw = line.trim();
    if (!raw || raw.startsWith("#")) continue;
    const idx = raw.indexOf("=");
    if (idx <= 0) continue;
    const key = raw.slice(0, idx).trim();
    const value = raw.slice(idx + 1).trim();
    if (!key) continue;
    out[key] = value;
  }
  return out;
}

export function inspectEnvText(text) {
  const lines = String(text || "").split(/\r?\n/);
  const invalidLineNumbers = [];
  const seen = new Set();
  const duplicateKeys = [];
  let validCount = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i].trim();
    if (!raw || raw.startsWith("#")) continue;
    const idx = raw.indexOf("=");
    if (idx <= 0) {
      invalidLineNumbers.push(i + 1);
      continue;
    }
    const key = raw.slice(0, idx).trim();
    if (!key) {
      invalidLineNumbers.push(i + 1);
      continue;
    }
    if (seen.has(key)) duplicateKeys.push(key);
    else seen.add(key);
    validCount += 1;
  }

  return {
    validCount,
    invalidLineNumbers,
    duplicateKeys
  };
}

export function envMapToText(map) {
  if (!map || typeof map !== "object") return "";
  return Object.entries(map)
    .map(([k, v]) => `${k}=${String(v ?? "")}`)
    .join("\n");
}

export function shortText(value, max = 120) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

export function permissionProfileLabel(mode) {
  if (mode === "full_auto") return "全部允许";
  if (mode === "accept_edits") return "自动接受编辑";
  return "标准";
}

export function formatElapsed(seconds) {
  const n = Math.max(0, Math.floor(seconds));
  if (n < 60) return `${n}s`;
  const m = Math.floor(n / 60);
  const s = n % 60;
  return `${m}m ${s}s`;
}

export function formatClockTime(ts) {
  const n = Number(ts || 0);
  if (!Number.isFinite(n) || n <= 0) return "-";
  return new Date(n).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function describeMcpProbe(runtime) {
  const r = runtime && typeof runtime === "object" ? runtime : {};
  const error = String(r.error || "");
  const isTimeout = /timed out/i.test(error);

  let probe = "未知";
  let level = "muted";
  if (r.checking === true) {
    probe = "检测中...";
  } else if (r.ok === true) {
    probe = "正常";
    level = "ok";
  } else if (r.ok === false) {
    probe = isTimeout ? `超时（不阻断）${error ? `: ${error}` : ""}` : `异常${error ? `: ${error}` : ""}`;
    level = isTimeout ? "warn" : "error";
  } else if (r.source === "active_session_missing") {
    probe = "待检测（无活跃会话）";
  } else if (r.source === "active_session_unavailable") {
    probe = `会话不可用${error ? `: ${error}` : ""}`;
    level = error ? "warn" : "muted";
  }

  const lastChecked =
    typeof r.lastCheckedAt === "number" && r.lastCheckedAt > 0
      ? `${formatClockTime(r.lastCheckedAt)}${typeof r.ageSeconds === "number" ? ` (${r.ageSeconds}s前)` : ""}`
      : "未检测";

  return { probe, level, lastChecked };
}

export function extractSlashCommand(text) {
  const m = String(text || "").trim().match(/^\/([a-zA-Z0-9_-]+)/);
  return m ? m[1].toLowerCase() : "";
}

export function flattenFiles(items, level = 0) {
  if (!Array.isArray(items)) return [];
  const out = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    out.push({ ...item, level });
    if (item.type === "directory" && Array.isArray(item.children) && item.children.length > 0) {
      out.push(...flattenFiles(item.children, level + 1));
    }
  }
  return out;
}

export function parseMcpToolName(rawName) {
  const name = String(rawName || "").trim();
  if (!name) return null;
  if (name.startsWith("mcp__")) {
    const parts = name.split("__").filter(Boolean);
    if (parts.length >= 3) return { server: parts[1], tool: parts.slice(2).join("__"), raw: name };
    return { server: "unknown", tool: name, raw: name };
  }
  if (name.startsWith("mcp:")) {
    const parts = name.split(":");
    if (parts.length >= 3) return { server: parts[1] || "unknown", tool: parts.slice(2).join(":"), raw: name };
    return { server: "unknown", tool: name, raw: name };
  }
  return null;
}

export function toolLabel(rawName) {
  const parsed = parseMcpToolName(rawName);
  if (parsed) return `${parsed.server}.${parsed.tool}`;
  return String(rawName || "").trim() || "unknown_tool";
}

export function formatPhaseLabel(phase) {
  const map = {
    queued: "已入队",
    waiting_user_input: "等待用户输入",
    waiting_permission: "等待权限确认",
    tool_running: "工具执行中",
    tool_summary: "工具结果汇总",
    responding: "生成回复中",
    completed: "已完成"
  };
  return map[String(phase || "")] || String(phase || "");
}

export function looksLikeToolClaim(text) {
  const t = String(text || "");
  if (!t) return false;
  return /(mcp__|mcp|search_literature|get_article_details|tool|工具|调用|检索|读取|保存到文件|skills?)/i.test(t);
}

export function normalizeSettings(data) {
  const runtimeEnv = data?.runtimeEnv || data?.mcpEnv || {};
  return {
    model: data?.model || "",
    baseUrl: data?.baseUrl || "",
    authToken: "",
    hasToken: data?.hasToken === true,
    tokenPreview: data?.tokenPreview || "",
    runtimeEnvText: envMapToText(runtimeEnv),
    permissionProfile:
      data?.permissionProfile === "full_auto" || data?.permissionProfile === "accept_edits"
        ? data.permissionProfile
        : "standard",
    mcpEnabled: data?.mcpEnabled !== false,
    speedModeEnabled: data?.speedModeEnabled === true,
    toolGateEnabled: data?.toolGateEnabled !== false,
    debugEnabled: data?.debugEnabled === true,
    debugSseEnabled: data?.debugSseEnabled === true
  };
}
