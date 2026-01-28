# Statusline 状态栏

自定义 Claude Code 状态栏，实时显示会话关键信息。

## 功能展示

```
[Claude] 💎 45% (1.2M) 📊 23% ⏳ 5m30s | 📋 k01 搭建博客 [███████░] 3/4 | 👤 QY | 🔧 5技能
```

| 指标 | 说明 |
|------|------|
| `[Claude]` | 当前使用的模型 |
| 💎 GLM 配额 | API 配额使用百分比和剩余量（带 5 分钟缓存） |
| 📊 上下文 | 当前会话上下文使用率 |
| ⏳ 会话时间 | 会话持续时长 |
| ↑↓ Token | 输入/输出 token 数量 |
| 📋 任务进度 | 当前活跃任务的进度条 |
| 👤 用户画像 | 用户名称和画像新鲜度警告 |
| 🔧 技能统计 | 当前掌握的用户技能数量 |

## 颜色含义

| 颜色 | 含义 |
|------|------|
| 🟢 绿色 | 使用率 < 50% |
| 🟡 黄色 | 使用率 50% - 80% |
| 🔴 红色 | 使用率 > 80% |

## 配置

配置文件：`.claude/settings.json`

```json
{
  "statusLine": {
    "type": "command",
    "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/statusline.sh"
  }
}
```

## 环境变量

| 变量 | 说明 |
|------|------|
| `ANTHROPIC_AUTH_TOKEN` | API 认证令牌（用于获取 GLM 配额） |
| `ANTHROPIC_BASE_URL` | API 基础 URL（用于获取 GLM 配额） |

## 状态文件

- **位置**：`.info/.status.json`
- **用途**：存储任务、用户、技能状态
- **更新**：由 PostToolUse hook 自动更新

## GLM 配额获取

状态栏会从 API 获取配额信息：
- **端点**：`/api/monitor/usage/quota/limit`
- **缓存**：5 分钟，存储在 `~/.claude/glm_quota_cache.txt`
- **失效**：如果未配置 `ANTHROPIC_AUTH_TOKEN` 或 `ANTHROPIC_BASE_URL`，则不显示配额信息

## 实现文件

- **脚本**：`.claude/statusline.sh`
- **Hook**：`.claude/hooks/update-status.sh`
- **配置**：`.claude/settings.json`

## 自定义

如需自定义显示内容，编辑 `.claude/statusline.sh` 脚本中的相关函数：
- `get_glm_quota()` - GLM 配额
- `get_context_usage()` - 上下文使用率
- `get_session_duration()` - 会话时长
- `get_token_stats()` - Token 统计
- `get_system_status()` - 系统状态
