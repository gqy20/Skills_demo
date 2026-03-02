# Skills Demo Agent Web

面向科研工作流的 Claude Agent SDK 可视化工作台。

它把 Claude Code 的核心能力（会话、Skills、MCP、工具权限确认、文件编辑）放到 Web 界面，适合本地或内网下进行“边看边改边协作”的研究任务。

## 核心能力

- 基于 `@ai-sdk/react` + SSE 的流式对话（`POST /api/chat/ui`）
- 多工作区切换（`AGENT_WORKSPACE_ROOT` + `AGENT_WORKSPACES`）
- Tool Gate：权限请求与 `AskUserQuestion` 人工确认
- Skills 面板：只展示本地拥有且 SDK 可用的命令
- Agents 面板：读取 `.claude/agents/*.md` 并尝试补充 SDK 元数据
- MCP 面板：读取 `.mcp.json`，展示缺失环境变量与运行时连接状态
- 会话持久化：会话索引 + 按会话分文件存储（`<workspace>/.info/chat-sessions/`）
- 文件树与编辑器：查看/搜索文件、读取与保存文本文件

## 技术栈

- 后端：Node.js + Express + TypeScript
- 前端：React + Vite + AI SDK UI
- Agent：`@anthropic-ai/claude-agent-sdk`
- 传输：`text/event-stream` + `x-vercel-ai-ui-message-stream: v1`

## 目录结构

```text
Skills_demo/
├─ src/
│  ├─ server/                # API、Agent 调用、会话与文件服务
│  └─ webapp/                # React 前端
├─ tests/                    # server/webapp 单测
├─ docs/                     # 架构与使用文档
├─ .claude/                  # skills / hooks / agents
├─ .info/                    # 运行时数据（会话、任务等）
├─ info/                     # 用户输入资料目录
└─ results/                  # 任务结果目录
```

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

至少确认这些字段：

- `ANTHROPIC_AUTH_TOKEN`
- `ANTHROPIC_MODEL`
- `ANTHROPIC_BASE_URL`

如需 MCP，再补充 `NOTION_TOKEN`、`ZOTERO_*`、`MINERU_API_KEY` 等。

### 3. 启动开发环境

```bash
npm run dev
```

默认地址：`http://127.0.0.1:3000`

说明：`npm run dev` 会先执行 `npm run build:web`，再以 `tsx` 启动后端。

## 构建与测试

```bash
# 类型检查
npm run check

# 单元测试
npm test

# 生产构建
npm run build

# 运行构建产物
npm start
```

## 环境变量

### 服务监听

- `HOST`：默认 `127.0.0.1`
- `PORT`：默认 `3000`

### 模型与鉴权

- `ANTHROPIC_MODEL`：默认 `glm-5`
- `ANTHROPIC_BASE_URL`：默认 `https://open.bigmodel.cn/api/anthropic`
- `ANTHROPIC_AUTH_TOKEN`：默认空

### 工作区

- `AGENT_WORKSPACE_ROOT`：主工作区（默认当前进程目录）
- `AGENT_WORKSPACES`：附加工作区（逗号或换行分隔）

### 运行时开关（会由 Web 设置写回 `.env`）

- `AGENT_WEB_PERMISSION_PROFILE`：`standard | accept_edits | full_auto`
- `AGENT_WEB_MCP_ENABLED`：`1/0`
- `AGENT_WEB_SPEED_MODE_ENABLED`：`1/0`
- `AGENT_WEB_TOOL_GATE_ENABLED`：`1/0`
- `AGENT_WEB_DEBUG_ENABLED`：`1/0`
- `AGENT_WEB_DEBUG_SSE_ENABLED`：`1/0`

### 会话持久化

- `CHAT_PERSISTENT_MAX_SESSIONS`：默认 `100`
- `CHAT_PERSISTENT_IDLE_TTL_MS`：默认 `600000`
- `CHAT_PERSISTENT_CLEANUP_INTERVAL_MS`：默认 `60000`

### MCP 探测缓存

- `AGENT_WEB_MCP_PROBE_TTL_MS`：默认 `60000`
- `AGENT_WEB_MCP_AUTO_REFRESH`：默认开启（非 `0` 即开启）

## API 概览

### 系统

- `GET /api/health`
- `GET /api/workspaces`
- `GET /api/settings`
- `POST /api/settings`
- `GET /api/skills`
- `GET /api/agents`
- `GET /api/mcps`
- `POST /api/mcps/refresh`

### 文件与会话

- `GET /api/files`
- `GET /api/files/search`
- `GET /api/file`
- `PUT /api/file`
- `GET /api/sessions`
- `GET /api/sessions/:sessionId`
- `DELETE /api/sessions/:sessionId`

### 对话与交互

- `POST /api/chat/ui`
- `POST /api/chat/stop`
- `POST /api/input`
- `POST /api/input/cancel`

## 前端主要区域

- Chat：流式回复、停止、重试
- Pending Overlay：权限确认与问答回填
- Session Sidebar：历史会话管理 + 文件树搜索/打开
- Inspector Sidebar：Skills、Agents、MCP、事件与调试信息
- File Editor Pane：文本文件查看与保存
- Settings：模型、Token、运行时开关、`runtimeEnvText`

## 与 `.claude` 的关系

本项目不替代 Claude Code 配置，而是可视化其能力：

- `/.claude/skills`：可被识别并展示
- `/.claude/agents`：显示在 Agents 面板
- `/.claude/hooks`：在非 speed mode 下按既有逻辑参与执行

## 常见问题

1. 启动时报 `Web assets not found in dist/web`

执行 `npm run build:web`，或直接使用 `npm run dev`。

2. 没有模型输出

检查 `ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_BASE_URL`、`ANTHROPIC_MODEL`。

3. 工具一直 pending

`standard` + `toolGateEnabled` 下需要在 Pending 面板 `allow/deny/cancel`。

4. 看不到 Skills / Agents

确认当前 workspace 下存在 `.claude/skills/*/SKILL.md` 或 `.claude/agents/*.md`。

## 相关文档

- [docs/architecture.md](docs/architecture.md)
- [docs/usage.md](docs/usage.md)
- [docs/hooks.md](docs/hooks.md)
- [docs/statusline.md](docs/statusline.md)
- [docs/agent-sdk-web-minimal.md](docs/agent-sdk-web-minimal.md)
- [docs/results.md](docs/results.md)
