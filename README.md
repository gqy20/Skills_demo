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

### 第一步：Fork 项目

1. 访问 [Skills Demo](https://github.com/gqy20/Skills_demo) 仓库
2. 点击右上角的 **Fork** 按钮
3. 将项目 fork 到你自己的 GitHub 账号下

### 第二步：创建 Codespace

1. 在你 fork 的仓库页面，点击 **Code** 按钮
2. 选择 **Codespaces** 标签
3. 点击 **Create codespace on main** 创建新的 Codespace
4. 等待 Codespace 启动完成

### 第三步：安装 Claude Code

官方推荐使用 **Native Install** 方式：

**macOS / Linux / WSL:**
```bash
curl -fsSL https://claude.ai/install.sh | bash
```

**Windows PowerShell:**
```powershell
irm https://claude.ai/install.ps1 | iex
```

**其他方式:**
```bash
# Homebrew
brew install --cask claude-code

# WinGet
winget install Anthropic.ClaudeCode
```

### 第四步：配置认证信息

配置环境变量以使用本地 API：

```bash
export ANTHROPIC_AUTH_TOKEN="your-auth-token-here"
export ANTHROPIC_BASE_URL="https://open.bigmodel.cn/api/anthropic"
```

### 第五步：清理默认文件

首次使用需要清理示例内容：

```bash
# 删除示例任务技能（保留核心技能）
rm -rf .claude/skills/k01_*
rm -rf .claude/skills/k02_*

# 保留的核心技能：
# - user-profile/   # 用户画像生成
# - commander/      # 任务指挥官
# - skill-generator/ # 技能生成器
```

### 第六步：准备个人信息

**上传你的个人文档到 `info/` 目录**

支持的文件格式：`.md`、`.json`、`.pdf`、`.txt`

建议文件：
```
info/
├── bio.md              # 个人简介
├── skills.md           # 技术栈
├── preferences.json    # 偏好配置
└── goals.md            # 目标与痛点
```

你可以上传任何包含你个人信息的文件，系统会自动分析并生成画像。

### 第七步（可选）：运行一键脚本

```bash
./scripts/quick-start.sh
```

脚本会自动完成：
1. 检查并安装 Claude Code
2. 清理示例技能
3. 清理旧数据
4. 初始化配置文件

### 第八步：运行第一个任务

```bash
# 1. 生成用户画像
/user-profile

# 2. 查看生成的画像
cat .info/usr.json

# 3. 启动一个简单任务测试
/commander start 创建一个 Hello World 页面

# 4. 按提示确认计划后，执行第一步
/commander continue k01
```

### 完整示例流程

```bash
# 从零开始的完整流程
fork 项目 → 创建 Codespace → 配置 Claude Code
    ↓
清理示例技能 → 准备个人信息 → 生成用户画像
    ↓
启动任务 → 逐步执行 → 查看结果
```

## 目录结构

```
.claude/skills/    # 技能目录
    ├── user-profile/    # 画像生成
    ├── commander/       # 指挥官（主入口）
    ├── skill-generator/ # 技能生成器
    └── k01_init_project/ # 生成的子技能

.info/             # 数据目录
    ├── usr.json        # 用户画像
    └── tasks.json      # 任务索引

info/              # 用户输入（个人信息）

results/           # 任务结果（执行过程文件）
    └── k01/           # 任务 k01 的结果
```

## 核心命令

| 命令 | 说明 |
|------|------|
| `/user-profile` | 生成用户画像 |
| `/commander start [任务]` | 启动新任务 |
| `/commander status` | 全局状态 |
| `/commander progress k01` | 任务进度 |
| `/k01_init_project` | 执行子技能 |

## 设计理念

- **以人为本** - 基于用户画像定制 AI 行为
- **任务驱动** - 将大任务拆解为可执行的子技能
- **过程可见** - 所有执行记录保存在 results/ 目录

## 文档

- [docs/usage.md](docs/usage.md) - 详细使用说明
- [docs/results.md](docs/results.md) - results/ 目录结构说明
- [docs/statusline.md](docs/statusline.md) - 状态栏配置说明
