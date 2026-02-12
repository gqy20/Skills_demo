# Claude Agent SDK Web 最小接入

## 目标

- 用 TypeScript 接入 `@anthropic-ai/claude-agent-sdk`
- 升级到最新 `0.2.x`
- 采用会话式 client 方案（`unstable_v2_createSession`）而非 `query`
- 提供流式接口 `POST /api/chat/stream` 给前端调用

## 文件

- `package.json`
- `tsconfig.json`
- `app/agent-client.ts`
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

- 当前为 NDJSON 流式：前端 `fetch` -> 后端逐行写事件 -> 前端实时渲染
- 仍保留 `POST /api/chat` 非流式接口，便于调试或回归测试
- 后端维护会话实例，前端携带 `sessionId` 进行多轮对话
- `POST /api/input` 当前返回 410（v2 session 路径暂不支持 `canUseTool` 拦截）
