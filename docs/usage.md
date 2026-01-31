# Skills Demo 使用指南

本文档提供 Skills Demo 的详细使用说明、命令参考和工作流示例。

## 前置条件

> 首次使用请先阅读 [README.md](../README.md#快速开始) 完成环境配置。

**核心概念**: 一个任务 = 多个子技能

```
任务 k01 (搭建 Next.js 博客)
    ├─ k01_init_project     # 子技能 1: 初始化项目
    ├─ k01_config_mdx        # 子技能 2: 配置 MDX
    ├─ k01_create_layout     # 子技能 3: 创建布局
    ├─ k01_article_list      # 子技能 4: 文章列表页
    └─ k01_article_detail    # 子技能 5: 文章详情页
```

## 核心命令

### 指挥官命令 (主入口)

| 命令 | 说明 |
|------|------|
| `/commander start [任务]` | 启动新任务 |
| `/commander status` | 全局状态视图 |
| `/commander progress k01` | 任务详细进度 |
| `/commander list` | 列出所有任务 |
| `/commander results k01` | 查看任务结果 |
| `/commander continue k01` | 继续执行下一步 |
| `/commander complete k01` | 标记任务完成 |
| `/commander archive k01` | 归档任务 |

### 其他命令

| 命令 | 说明 |
|------|------|
| `/user-profile` | 生成用户画像 |
| `/k01_init_project` | 执行指定子技能 |

## 使用流程

### 1. 建立用户画像

将任意资料文件放入 `info/` 目录，系统会自动分析。

**支持的格式**: `.md`、`.json`、`.pdf`、`.txt`

**运行命令**:
```
/user-profile
```

生成 `.info/usr.json` 用户画像文件。

### 2. 启动任务

```
/commander start 搭建 Next.js 博客
```

指挥官会自动：
1. 检查用户画像是否存在
2. 将任务拆解为可执行步骤
3. 展示计划并等待确认
4. 生成对应的子技能
5. 创建 `results/k01/` 目录

### 3. 执行步骤

**方式一**: 逐个执行子技能
```
/k01_init_project
/k01_config_mdx
/k01_create_layout
```

**方式二**: 使用指挥官自动继续
```
/commander continue k01    # 自动执行下一步
```

### 4. 查看结果

```
/commander results k01     # 查看任务结果
/commander progress k01    # 查看任务进度
```

结果保存在 `results/k01/` 目录：
- `README.md` - 任务总览
- `plan.md` - 任务计划
- `execution.md` - 执行记录
- `artifacts/` - 生成的文件

## 目录结构

详细目录结构请参考 [README.md](../README.md#目录结构)。

## 子技能命名规范

| 步骤类型 | 命名模式 | 示例 |
|---------|---------|------|
| 初始化 | `k[任务]_init_[项目]` | k01_init_project |
| 配置 | `k[任务]_config_[功能]` | k01_config_mdx |
| 创建 | `k[任务]_create_[组件]` | k01_create_layout |
| 实现 | `k[任务]_[feature]` | k01_article_list |
| 修复 | `k[任务]_fix_[问题]` | k01_fix_routing |
| 测试 | `k[任务]_test_[模块]` | k01_test_api |

## 技能类型

| 类型 | 前缀 | 说明 | 数量限制 | 存储位置 |
|:-----|:-----|:-----|:---------|:---------|
| **内置技能** | 无 | user-profile, commander, skill-generator | 固定 | `.claude/skills/` |
| **任务技能** | `k_` | 任务拆解生成的子技能 | 无限制 | `.claude/skills/` |
| **用户技能** | `u_` | 从用户经验提取的技能 | ≤ 5 | `tasks.json.user_skills` |
| **验证技能** | `p_` | 经验证可复用的技能（k_ 升级） | ≤ 10 | `tasks.json.proven_skills` |

### 技能升级流程

```
k_ 技能（任务子技能）
    ↓ 验证通过
p_ 技能（验证技能）→ 可复用到新任务
    ↓ 高频使用
考虑纳入 u_ 技能（用户经验）
```

## tasks.json 结构

```json
{
  "next_id": 2,
  "tasks": {
    "k01": {
      "id": "k01",
      "name": "搭建 Next.js 博客",
      "type": "web",
      "status": "active",
      "steps": [
        "k01_init_project",
        "k01_config_mdx",
        "k01_create_layout",
        "k01_article_list",
        "k01_article_detail"
      ],
      "current_step": 0,
      "created_at": "2026-01-27T16:00:00Z"
    }
  },
  "user_skills": {
    "u_react_hooks": {
      "name": "u_react_hooks",
      "level": "proficient",
      "created_at": "2026-01-27T16:00:00Z",
      "usage_count": 0
    }
  },
  "proven_skills": {
    "p_nextjs_blog": {
      "name": "p_nextjs_blog",
      "source_task": "k01",
      "created_at": "2026-01-27T18:00:00Z",
      "usage_count": 3,
      "related_tasks": ["k02", "k03"]
    }
  },
  "archived_u_skills": []
}
```

## 结果文件说明

### results/k01/README.md
任务总览，包含：
- 基本信息（编号、类型、状态）
- 进度条
- 步骤列表
- 下一步指引

### results/k01/plan.md
任务计划，包含：
- 步骤列表
- 每步的预期产出
- 技术栈选型

### results/k01/execution.md
执行记录，包含：
- 每步的开始/完成时间
- 执行内容
- 遇到的问题和解决方案

### results/k01/artifacts/
执行过程中生成的文件

## 完整示例

```bash
# 1. 准备用户信息
# 将任意资料丢入 info/ 目录（支持 .md, .json, .pdf, .txt）

# 2. 生成用户画像
/user-profile

# 3. 启动任务
/commander start 搭建 Next.js 博客

# 系统展示计划，确认后生成子技能

# 4. 执行第一步
/k01_init_project

# 5. 查看进度
/commander progress k01

# 6. 继续下一步
/commander continue k01

# 7. 查看结果
/commander results k01
```

## 文件格式支持

`info/` 目录支持以下格式，系统会自动识别内容类型：

| 格式 | 用途 | 示例 |
|------|------|------|
| `.md` | 个人自述、文档、对话记录 | note.md, Continue会话.md |
| `.json` | 结构化配置 | preferences.json |
| `.pdf` | 简历、文档 | 我的简历.pdf |
| `.txt` | 笔记、随笔 | notes.txt |

**无需按固定文件名组织** - 随意丢文件，系统自动分析。

## 任务状态

| 状态 | 说明 |
|------|------|
| `active` | 进行中 |
| `completed` | 已完成 |
| `archived` | 已归档 |

---

## 辅助功能

### 任务完成通知

系统在会话结束时自动提供视觉和声音提示：

**自动触发**（Stop Hook）：
- 终端标题更新为 "✓ Claude 响应完成"
- 醒目的视觉提示框（闪烁边框）
- 可选的声音播放

**声音依赖**（可选）：
| 工具 | 安装命令 |
|------|----------|
| `aplay` | `apt install alsa-utils` |
| `beep` | `apt install beep` |

### 浏览器通知（可选）

在 Codespace 等环境中，可启动浏览器通知服务器：

```bash
# 启动通知服务器
bash .claude/hooks/start-notify-server.sh

# 访问地址: http://localhost:8888/notify
```

**Codespace 使用步骤**：
1. 启动服务器后，点击 "Ports" 标签
2. 找到端口 8888 并点击 "Forward"
3. 打开浏览器访问转发后的地址
4. 点击 "启用浏览器通知" 按钮授权

通知页面会实时显示 Claude 完成响应的状态，并支持浏览器原生通知。

---

详细配置请参考 [Hooks 系统](hooks.md) 和 [状态栏配置](statusline.md)。
