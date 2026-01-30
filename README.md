# Skills Demo

基于 Claude Code Skills 的个人 AI 辅助开发系统。

## 核心思路

```
用户画像 → 任务拆解 → 子技能生成 → 逐步执行 → 结果记录
```

### 工作流程

1. **建立画像** - 在 `info/` 目录添加个人信息，运行 `/user-profile`
2. **启动任务** - 使用 `/commander start [任务描述]` 创建新任务
3. **执行步骤** - 逐个使用生成的子技能完成每一步
4. **查看结果** - 在 `results/k01/` 查看执行过程和产出文件

### 快速开始

**推荐方式**：使用一键启动脚本

```bash
./scripts/start.sh
```

脚本会自动完成：
1. 检查并安装 Claude Code
2. 检查并安装 uv（Python 包管理器）
3. 清理示例技能
4. 清理旧数据
5. 初始化配置文件

**手动安装**（如需自定义）：

1. **Fork 项目并创建 Codespace**
   - 访问 [Skills Demo](https://github.com/gqy20/Skills_demo)
   - 点击 Fork，然后创建 Codespace

2. **安装 Claude Code**

   macOS/Linux/WSL:
   ```bash
   curl -fsSL https://claude.ai/install.sh | bash
   ```

   Windows PowerShell:
   ```powershell
   irm https://claude.ai/install.ps1 | iex
   ```

3. **配置认证信息**

   ```bash
   export ANTHROPIC_AUTH_TOKEN="your-auth-token-here"
   export ANTHROPIC_BASE_URL="https://open.bigmodel.cn/api/anthropic"
   ```

4. **准备个人信息**

   将任意资料丢入 `info/` 目录（支持 `.md`、`.json`、`.pdf`、`.txt`）

5. **运行第一个任务**

   ```bash
   # 生成用户画像
   /user-profile

   # 启动任务
   /commander start 创建一个 Hello World 页面

   # 执行第一步
   /commander continue k01
   ```

## 📖 详细文档

- [使用指南](docs/usage.md) - 完整命令参考、数据结构说明、工作流示例
- [结果目录说明](docs/results.md) - results/ 目录结构详解
- [状态栏配置](docs/statusline.md) - 自定义状态栏使用说明
- [Hooks 系统](docs/hooks.md) - 自动化钩子详解

## 目录结构

```
.claude/
├── skills/           # 技能目录
│   ├── user-profile/    # 画像生成
│   ├── commander/       # 指挥官（主入口）
│   ├── skill-generator/ # 技能生成器
│   └── k01_init_project/ # 生成的子技能
├── hooks/            # Hooks 脚本
│   ├── session-start.sh      # 会话启动检查
│   ├── track-skills-change.sh # 技能变更追踪
│   ├── update-status.sh      # 状态更新
│   └── count-skills-usage.sh # 技能使用统计
├── statusline.sh      # 自定义状态栏
└── settings.json      # Claude Code 配置

.info/                # 数据目录
    ├── usr.json        # 用户画像
    ├── tasks.json      # 任务索引
    └── .status.json    # 运行时状态

info/                 # 用户输入（个人信息）

results/              # 任务结果（执行过程文件）
    └── k01/           # 任务 k01 的结果

.mcp.json            # MCP 服务器配置
```

## 核心命令

| 命令 | 说明 |
|------|------|
| `/user-profile` | 生成用户画像 |
| `/commander start [任务]` | 启动新任务 |
| `/commander status` | 全局状态 |
| `/commander progress k01` | 任务进度 |
| `/k01_init_project` | 执行子技能 |

> 💡 完整命令参考请查看 [使用指南](docs/usage.md#核心命令)

## 设计理念

- **以人为本** - 基于用户画像定制 AI 行为
- **任务驱动** - 将大任务拆解为可执行的子技能
- **过程可见** - 所有执行记录保存在 results/ 目录
