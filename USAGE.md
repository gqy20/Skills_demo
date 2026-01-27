# Skills Demo 使用指南

基于 Claude Code Skills 的个人 AI 辅助开发系统。

## 系统概述

```
用户信息 (info/) → 用户画像 (.info/usr.json)
                                  ↓
/k start [任务] → 任务拆解 → 子技能生成 (k01_init, k01_config, ...)
                                  ↓
                        逐步执行 → 结果记录 (results/k01/)
```

**核心概念**: 一个任务 = 多个子技能

```
任务 k01 (搭建 Next.js 博客)
    ├─ k01_init_project     # 子技能 1
    ├─ k01_config_mdx        # 子技能 2
    ├─ k01_create_layout     # 子技能 3
    ├─ k01_article_list      # 子技能 4
    └─ k01_article_detail    # 子技能 5
```

## 核心命令

### 指挥官命令 (主入口)

| 命令 | 说明 |
|------|------|
| `/k start [任务]` | 启动新任务 |
| `/k status` | 全局状态视图 |
| `/k progress k01` | 任务详细进度 |
| `/k list` | 列出所有任务 |
| `/k results k01` | 查看任务结果 |
| `/k continue k01` | 继续执行下一步 |
| `/k complete k01` | 标记任务完成 |
| `/k archive k01` | 归档任务 |

### 其他命令

| 命令 | 说明 |
|------|------|
| `/user-profile` | 生成用户画像 |
| `/k01_init_project` | 执行指定子技能 |

## 使用流程

### 第一步：建立用户画像

在 `info/` 目录添加个人信息文件：

```
info/
├── bio.md              # 个人简介
├── skills.md           # 技术栈
├── preferences.json    # 偏好配置
└── goals.md            # 目标与痛点
```

运行：
```
/user-profile
```

生成 `.info/usr.json` 用户画像。

### 第二步：启动任务

```
/k start 搭建 Next.js 博客
```

指挥官会：
1. 检查用户画像
2. 拆解任务为步骤
3. 展示计划并等待确认
4. 生成子技能
5. 创建 `results/k01/` 目录

### 第三步：执行步骤

```
/k01_init_project    # 执行第一步
/k01_config_mdx       # 执行第二步
...
```

或使用：
```
/k continue k01       # 自动执行下一步
```

### 第四步：查看结果

```
/k results k01        # 查看任务结果
```

结果保存在 `results/k01/`：
- `README.md` - 任务总览
- `plan.md` - 任务计划
- `execution.md` - 执行记录
- `artifacts/` - 生成的文件

## 目录结构

```
.claude/skills/              # 技能目录
├── user-profile/            # 画像生成
├── commander/               # 指挥官（主入口）
├── skill-generator/         # 技能生成器
└── k01_init_project/        # 生成的子技能

.info/                       # 数据目录
├── usr.json                 # 用户画像
└── tasks.json               # 任务索引

info/                        # 用户输入
├── bio.md
├── skills.md
├── preferences.json
└── goals.md

results/                     # 任务结果
├── k01/                     # 任务 k01 的结果
│   ├── README.md
│   ├── plan.md
│   ├── execution.md
│   └── artifacts/
└── archived/                # 归档的任务
```

## 子技能命名规范

| 步骤类型 | 命名模式 | 示例 |
|---------|---------|------|
| 初始化 | `k[任务]_init_[项目]` | k01_init_project |
| 配置 | `k[任务]_config_[功能]` | k01_config_mdx |
| 创建 | `k[任务]_create_[组件]` | k01_create_layout |
| 实现 | `k[任务]_[feature]` | k01_article_list |
| 修复 | `k[任务]_fix_[问题]` | k01_fix_routing |
| 测试 | `k[任务]_test_[模块]` | k01_test_api |

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
  }
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

```
# 1. 准备用户信息
# 在 info/ 目录添加 bio.md, skills.md 等

# 2. 生成用户画像
/user-profile

# 3. 启动任务
/k start 搭建 Next.js 博客

# 系统展示计划，确认后生成子技能

# 4. 执行第一步
/k01_init_project

# 5. 查看进度
/k progress k01

# 6. 继续下一步
/k continue k01

# 7. 查看结果
/k results k01
```

## 文件格式支持

`info/` 目录支持：

| 格式 | 用途 | 示例 |
|------|------|------|
| `.md` | 个人自述、文档 | bio.md, goals.md |
| `.json` | 结构化配置 | preferences.json |
| `.pdf` | 简历、文档 | resume.pdf |
| `.txt` | 笔记、随笔 | notes.txt |

## 任务状态

| 状态 | 说明 |
|------|------|
| `active` | 进行中 |
| `completed` | 已完成 |
| `archived` | 已归档 |

## 设计理念

- **任务驱动**: 以任务为中心，拆解为可执行的子技能
- **简单优先**: 核心流程清晰，不引入过多抽象
- **增量迭代**: 每个子技能完成一步，逐步推进
- **以人为本**: 围绕用户画像定制 AI 行为
- **过程可见**: 所有执行记录保存在 results/ 目录
