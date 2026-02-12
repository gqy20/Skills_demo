# Claude Agent SDK Web 最小接入

## 目标

- 用 TypeScript 接入 `@anthropic-ai/claude-agent-sdk`
- 升级到最新 `0.2.x`
- 提供 SSE 流式接口 `POST /api/chat/sse` 给前端调用
- 支持 `AskUserQuestion`/权限请求回传：前端通过 `POST /api/input` 响应
- 提供设置界面，可配置并持久化：
  - `ANTHROPIC_MODEL`
  - `ANTHROPIC_BASE_URL`
  - `ANTHROPIC_AUTH_TOKEN`

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

- 当前为 SSE (`text/event-stream`)：前端 `fetch` + SSE 解析器实时渲染
- 仍保留 `POST /api/chat` 非流式接口，便于调试或回归测试
- 完整流式开启方式：
  - `query(..., { includePartialMessages: true })`
  - 后端将 `stream_event/content_block_delta/text_delta` 转换为 `delta` SSE 事件
  - 前端按 `delta` 逐步拼接气泡文本
- SSE 每 15 秒发送 heartbeat（`: heartbeat`）避免长连接被中间代理超时
- 多轮会话通过本地 `sessionId -> sdk session_id` 映射实现（`resume`）
- 设置存储于 `.info/agent-web-settings.json`，后端在每次 `query` 通过 `options.env` 注入生效
- 当 SDK 触发 `canUseTool`：
  - `AskUserQuestion` 下发 `ask_user_question` SSE 事件
  - 其他工具下发 `permission_request` SSE 事件
  - 前端调用 `POST /api/input` 返回 `allow/deny`、可选 `updatedInput`、`alwaysAllow`
