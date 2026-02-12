# Claude Agent SDK Web 最小接入

## 目标

- 用 TypeScript 接入 `@anthropic-ai/claude-agent-sdk`
- 提供流式接口 `POST /api/chat/stream` 给前端调用
- 支持 `canUseTool` 交互回传：前端通过 `POST /api/input` 回答 `AskUserQuestion` / 权限请求
- 复用项目级 `.claude/settings.json`（通过 `settingSources: ["project"]`）

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

- 当前为 NDJSON 流式：前端 `fetch` -> 后端逐行写事件 -> 前端实时渲染
- 仍保留 `POST /api/chat` 非流式接口，便于调试或回归测试
- 当 SDK 触发 `canUseTool`：
  - `AskUserQuestion` 会下发 `ask_user_question` 事件给前端
  - 其他工具会下发 `permission_request` 事件给前端
  - 前端调用 `POST /api/input` 返回 `allow/deny` 和可选 `updatedInput`
