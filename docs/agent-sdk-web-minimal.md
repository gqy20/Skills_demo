# Claude Agent SDK Web 最小接入

## 目标

- 用 TypeScript 接入 `@anthropic-ai/claude-agent-sdk`
- 升级到最新 `0.2.x`
- 提供 AI SDK UI Message Stream 接口 `POST /api/chat/ui` 给前端调用
- 支持 `AskUserQuestion`/权限请求回传：前端通过 `POST /api/input` 响应
- 支持请求取消：前端通过 `POST /api/input/cancel` 中止待处理请求
- 支持流式停止：前端通过 `POST /api/chat/stop` 中止当前流
- 支持技能列表读取：前端通过 `GET /api/skills` 展示可用 skills
- 提供设置界面，可配置并持久化：
  - `ANTHROPIC_MODEL`
  - `ANTHROPIC_BASE_URL`
  - `ANTHROPIC_AUTH_TOKEN`
- 提供 MCP 快速开关按钮（临时禁用/启用）
- 提供性能模式开关（用于快速验证流式首包速度）

## 文件

- `package.json`
- `tsconfig.json`
- `app/server.ts`
- `app/index.html`
- `app/main.js`
- `app/styles.css`

## 运行

```bash
npm install
npm run dev
```

打开：

```text
http://localhost:3000
```

## 环境变量

确保你本机已有可用的 Claude Code/Anthropic 环境变量（例如 `ANTHROPIC_AUTH_TOKEN`）。  
该最小版本不额外封装鉴权，直接使用当前运行环境中的配置。

## 说明

- 当前为 SSE (`text/event-stream`) + AI SDK UI Message Stream 协议（`x-vercel-ai-ui-message-stream: v1`）
- 请求体对齐 AI SDK：`{ id, messages }`
- Skills 列表基于 Claude Agent SDK 原生 `supportedCommands()` 获取并缓存（30s）
- 完整流式开启方式：
  - `query(..., { includePartialMessages: true })`
  - 后端将 `stream_event/content_block_delta/text_delta` 转换为 `text-delta` 协议块
  - 结束时发送 `finish` 和 `[DONE]`
- SSE 每 15 秒发送 heartbeat（`: heartbeat`）避免长连接被中间代理超时
- 多轮会话通过本地 `sessionId -> sdk session_id` 映射实现（`resume`）
- 设置存储于 `.info/agent-web-settings.json`，后端在每次 `query` 通过 `options.env` 注入生效
- MCP 开关存储于同一配置文件，后端会在每次 query 启动时批量调用 `toggleMcpServer` 应用开关状态
- 性能模式开启后：
  - `settingSources = []`（不加载 project settings/hook）
  - `thinking = disabled`
  - 跳过 MCP 批量 toggle 步骤
- `toolGateEnabled`（交互网关）开关：
  - ON：启用 `canUseTool`，支持 AskUserQuestion/权限回传
  - OFF：禁用 `canUseTool`，用于纯流式链路排障
- 新增调试开关：
  - `debugEnabled`：启用 SDK `debug + stderr`，并执行原生控制探针（`initializationResult`/`accountInfo`/`mcpServerStatus`/`supportedModels`）
  - `debugSseEnabled`：将调试信息以 `data-debug` 块下发到前端
- 当 SDK 触发 `canUseTool`：
  - `AskUserQuestion` 下发 `data-ask-user-question-created`
  - 其他工具下发 `data-permission-request-created`
  - 生命周期状态包含：`*-resolved`、`*-timeout`、`*-canceled`
  - 前端调用 `POST /api/input` 返回 `allow/deny`、可选 `updatedInput`、`alwaysAllow`
  - 支持 `POST /api/input/cancel` 主动取消，并保持幂等返回
- 前端支持“停止/重试”：
  - Stop：`AbortController` + 后端 `POST /api/chat/stop`
  - Retry：复用最后一条用户消息重新发起请求
