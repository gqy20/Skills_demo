# Skills Demo Agent Web

一个面向科研工作流的 Claude Code Web 工作台（可理解为“科研版 Claude cowork”）：
- 在浏览器中与 Claude Agent SDK 进行流式对话
- 在会话中处理工具权限确认与 AskUserQuestion
- 查看并切换 Workspace、Skills、文件树
- 为科研常见流程提供快捷入口（文献分析、科研初稿生成）

## 项目定位

本项目不是“纯聊天壳”，而是把 Claude Code 的工程能力（skills、hooks、MCP、会话恢复）放到可视化界面中，方便科研场景下的人机协作：
- 文献整理和摘要
- 研究问题拆解
- 方法与实验设计草稿生成
- 多工作区并行管理

## 核心能力

- AI SDK UI Message Stream 协议接入（`POST /api/chat/ui`）
- 流式 SSE 输出，支持增量文本、事件调试、心跳保活
- 会话恢复：`sessionId -> sdk session_id` 映射，支持多轮上下文续接
- 工具交互网关（Tool Gate）：
  - `AskUserQuestion` 交互回传
  - 工具权限请求（allow/deny/cancel）
- 运行时开关：`MCP`、`Tool Gate`、`Speed Mode`、`Debug`
- 多工作区支持：通过 `AGENT_WORKSPACE_ROOT` + `AGENT_WORKSPACES`
- Skills 列表展示（仅 project/user skills，带 SDK 能力过滤）
- 工作区文件树 API（遵循 `.gitignore` + 内置忽略规则）
- 设置持久化：写入 `<workspace>/.info/agent-web-settings.json`

## 外部核对结论（GitHub/官方资料）

基于对 Anthropic 官方仓库、Vercel AI SDK 文档和同类开源 WebUI 的核对，本项目当前方向是正确的，且有三点优势：

- 与 Claude Agent SDK 深度对齐：`canUseTool` + pending input 回传链路完整
- 与 AI SDK UI Message Stream 对齐：SSE 事件模型和前端 `useChat` 兼容
- 兼顾本地工程工作流：workspace/skills/files 三块信息在一个界面内闭环

基于外部项目的推断（非本仓库现状）：
- 若要走“团队可用”的科研 cowork 产品化路线，下一阶段优先级应是 `鉴权/权限边界`、`审计日志`、`任务/文档持久化`，而不是继续增加 UI 控件。

## 技术栈

- 后端：Node.js + Express + TypeScript
- Agent：`@anthropic-ai/claude-agent-sdk`
- 前端：React + `@ai-sdk/react` + Vite
- 协议：SSE（`text/event-stream`）+ `x-vercel-ai-ui-message-stream: v1`

## 快速开始

### 1. 克隆仓库

```bash
git clone https://github.com/gqy20/Skills_demo.git
cd Skills_demo
```

### 2. 安装依赖

```bash
npm install
```

### 3. 启动开发环境

```bash
npm run dev
```

默认监听：`http://127.0.0.1:3000`

说明：`npm run dev` 会先构建前端静态资源（`build:web`），再启动 TypeScript 后端。

### 4. 打开 Web 界面

访问：`http://127.0.0.1:3000`

## 构建与运行

```bash
# 类型检查
npm run check

# 生产构建（server + web）
npm run build

# 运行构建产物
npm start
```

## 环境变量

后端默认值（来自 `src/server/index.ts`）：

- `HOST`：默认 `127.0.0.1`
- `PORT`：默认 `3000`
- `ANTHROPIC_MODEL`：默认 `glm-5`
- `ANTHROPIC_BASE_URL`：默认 `https://open.bigmodel.cn/api/anthropic`
- `ANTHROPIC_AUTH_TOKEN`：默认空
- `MINERU_API_KEY`：默认空
- `NOTION_TOKEN`：Notion MCP token（默认空）
- `ZOTERO_LOCAL`：Zotero MCP 本地模式开关（建议 `true`）
- `ZOTERO_API_KEY`：Zotero Web API key（本地模式可留空）
- `ZOTERO_LIBRARY_ID`：Zotero 库 ID（Web API 模式必填）
- `ZOTERO_LIBRARY_TYPE`：`user` 或 `group`
- `AGENT_WEB_DEBUG=1`：启用后端 debug 探针
- `AGENT_WEB_DEBUG_SSE=1`：通过 SSE 下发 debug 事件

工作区相关：

- `AGENT_WORKSPACE_ROOT`：主工作区（默认当前进程目录）
- `AGENT_WORKSPACES`：附加工作区列表（逗号或换行分隔）

### Notion / Zotero Token 获取

1. `NOTION_TOKEN`
   1. 打开 `https://www.notion.so/profile/integrations`
   2. 创建 Internal Integration 并复制 token（`ntn_...`）
   3. 在对应页面/数据库把该 Integration 加入权限

2. Zotero（两种模式）
   1. 本地模式：`ZOTERO_LOCAL=true`，通常无需 `ZOTERO_API_KEY`
   2. Web API 模式：
      1. 在 `https://www.zotero.org/settings/keys` 创建 API key
      2. 设置 `ZOTERO_LOCAL=false`
      3. 配置 `ZOTERO_API_KEY`、`ZOTERO_LIBRARY_ID`、`ZOTERO_LIBRARY_TYPE`

## 运行时设置（Web 内可改）

通过设置弹窗可修改并持久化：

- `model`
- `baseUrl`
- `authToken`
- `runtimeEnvText`（统一管理 `MINERU_API_KEY`、`NOTION_TOKEN`、`ZOTERO_*` 等）
- `mcpEnabled`
- `speedModeEnabled`
- `toolGateEnabled`
- `debugEnabled`
- `debugSseEnabled`
- 手动同步到 `.env`（需输入确认串 `SYNC .ENV`）

配置保存位置：

- `<workspace>/.info/agent-web-settings.json`

环境优先级（运行时）：

- `.env`（已加载到 `process.env`）高于 UI 保存配置
- UI 保存配置可作为回退值；可通过“同步到 .env”写回并统一来源

### Speed Mode 行为

启用后会走快速路径：
- `settingSources = []`（不加载 project settings/hooks）
- `thinking` 关闭
- 跳过 MCP 批量 toggle

## API 一览

### 系统接口

- `GET /api/health`：健康状态、workspace、hooks 模式
- `GET /api/workspaces`：可用工作区列表
- `GET /api/settings`：读取当前工作区设置
- `POST /api/settings`：更新当前工作区设置
- `POST /api/settings/sync-dotenv`：将当前 UI 设置手动同步到 `<workspace>/.env`（需确认串）
- `GET /api/skills`：读取 skills（project/user）
- `GET /api/files`：读取工作区文件树（`path` + `depth`）

### 对话与交互

- `POST /api/chat/ui`：主对话流接口（SSE）
- `POST /api/chat/stop`：中止当前会话流
- `POST /api/input`：响应 AskUserQuestion/权限请求
- `POST /api/input/cancel`：取消待处理输入

## 生产安全建议

当前实现更偏本地/内网开发环境。若部署到共享网络，建议至少补齐：

- 访问控制：为所有 `/api/*` 增加鉴权（反向代理 Basic Auth、OIDC、或网关 Token）
- 网络边界：保持 `HOST=127.0.0.1`，对外暴露时只经受控反向代理
- 密钥策略：避免把长效 token 明文落盘，优先短期令牌或密钥管理服务
- 审计能力：记录关键操作（模型切换、工具授权、MCP 开关、会话停止）
- 会话隔离：多用户场景下增加用户级 session namespace，避免会话串扰

## 前端功能概览

- Chat 主区：流式消息、停止、重试
- Quick Prompts：
  - 文献综述分析
  - 科研初稿生成
- Pending Overlay：
  - 工具权限确认（allow/deny/cancel）
  - AskUserQuestion 多题问答
- 侧栏：
  - Workspace 切换
  - Skills 列表
  - 文件树预览
  - 事件流调试信息

## 与 Skills/Hooks 的关系

仓库仍保留 Claude Code 的 skills 与 hooks 体系（`/.claude`），Web 层是其可视化入口与调度层：

- Skills 目录：`.claude/skills/`
  - `commander`
  - `user-profile`
  - `skill-generator`
  - `pdf_processor`
- Hooks 目录：`.claude/hooks/`

相关文档：
- `docs/usage.md`
- `docs/hooks.md`
- `docs/statusline.md`
- `docs/agent-sdk-web-minimal.md`

## 常见问题

1. 页面打开报 `Web assets not found in dist/web`  
   先执行 `npm run build:web`，或直接用 `npm run dev`。

2. 没有返回模型内容  
   检查 `ANTHROPIC_AUTH_TOKEN`、`baseUrl`、`model` 是否有效。

3. 工具一直等待确认  
   检查 `Gate` 是否开启；开启后需在 Pending 面板手动允许或回答问题。

4. 看不到 Skills  
   检查 `.claude/skills/*/SKILL.md` 是否存在，及工作区是否选对。

## 备注

- 本 README 已按当前代码实现（`src/server/*` + `src/webapp/*`）更新。
- 若你要继续强化“科研 cowork”定位，建议下一步补充：
  - 领域化 Prompt 模板库（研究问题、实验设计、审稿回复）
  - 论文库索引与检索 API
  - 结果导出（Markdown/Word）流水线

## 参考资料

- Anthropic Claude Code（官方仓库）：https://github.com/anthropics/claude-code
- Claude Agent SDK（官方仓库）：https://github.com/anthropics/claude-agent-sdk-typescript
- Claude Code SDK 文档（`canUseTool`）：https://docs.anthropic.com/zh-CN/docs/claude-code/sdk/sdk-tool-permissions
- Vercel AI SDK `useChat`：https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat
- Vercel AI SDK UI Message Stream 协议：https://sdk.vercel.ai/providers/ai-sdk-providers/anthropic#ui-message-stream-example
- 同类开源项目（对比参考）：https://github.com/siteboon/claudecodeui
- 同类开源项目（对比参考）：https://github.com/daodao97/chatbox
