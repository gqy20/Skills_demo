# Skills Demo System 使用指南

这是一个基于 Claude Code Skills 的个人 AI 辅助开发系统，通过用户画像和任务驱动的技能生成，提供定制化的开发帮助。

## 系统概述

```
用户信息 (info/) → 用户画像 (.info/usr.json)
                                  ↓
任务输入 (/new-skill) → 任务拆解 → 子技能生成 (k01_xxx, k01_yyy, ...)
```

**核心概念**: 一个任务 = 多个子技能

```
任务 k01 (搭建 Next.js 博客)
    ├─ k01_init_project     (初始化项目)
    ├─ k01_config_mdx        (配置 MDX)
    ├─ k01_create_layout     (创建布局)
    ├─ k01_article_list      (文章列表页)
    └─ k01_article_detail    (文章详情页)
```

## 核心概念

### 1. 用户画像 (User Profile)
系统根据 `info/` 目录下的文件自动生成用户画像，包含：
- **基础信息**: 姓名、角色、经验等级
- **技术栈**: 语言、框架、工具
- **偏好风格**: 代码风格、沟通方式
- **行为模式**: 工作风格、协作偏好
- **目标痛点**: 学习方向、常见问题

### 2. 任务与子技能

| 层级 | 说明 | 示例 |
|------|------|------|
| **任务** | 一个完整的项目或功能 | k01: 搭建 Next.js 博客 |
| **子技能** | 任务中的一个执行步骤 | k01_init_project |

- 每个任务分配唯一编号：`k01`, `k02`, `k03`...
- 一个任务拆解为 2-10 个步骤
- 每个步骤生成一个独立的子技能

### 3. 技能生成流程

```
1. 读取用户画像
2. 分配任务编号 (k01)
3. 拆解任务为步骤
4. 为每步规划 Skill 内容
5. 展示计划并确认
6. 批量生成子技能
7. 更新文档
```

## 目录结构

```
.
├── .claude/
│   ├── settings.json           # Claude Code 配置
│   └── skills/
│       ├── user-profile/       # 用户画像生成技能
│       ├── skill-generator/    # 技能生成器
│       ├── k01_init_project/   # k01 任务的子技能
│       ├── k01_config_mdx/     # k01 任务的子技能
│       ├── k01_create_layout/  # k01 任务的子技能
│       └── k02_xxx/            # k02 任务的子技能
├── .info/
│   ├── usr.json                # 用户画像
│   ├── usr.json.template       # 画像模板
│   └── tasks.json              # 任务索引
└── info/                       # 用户输入文件
    ├── bio.md                  # 个人简介
    ├── skills.md               # 技能清单
    ├── preferences.json        # 偏好配置
    └── goals.md                # 目标规划
```

## 使用流程

### 第一步：建立用户画像

在 `info/` 目录下添加个人信息文件：

```bash
info/
├── bio.md              # 推荐：Markdown 格式
├── skills.md           # 技术栈说明
├── preferences.json    # 结构化偏好
└── goals.md            # 目标与痛点
```

然后运行：
```
/user-profile
```

系统将分析所有文件，生成 `.info/usr.json`。

### 第二步：创建任务并生成子技能

当有新任务时，使用：
```
/new-skill [任务描述]
```

例如：
```
/new-skill 搭建 Next.js 博客
/new-skill 实现用户认证系统
/new-skill 编写 API 接口
```

### 第三步：确认计划并生成

系统会展示生成计划：

```
═══════════════════════════════════════════════════════
任务: 搭建 Next.js 博客
编号: k01
类型: web 开发
═══════════════════════════════════════════════════════

将生成 5 个子技能:

1. k01_init_project     - 初始化 Next.js 项目
2. k01_config_mdx        - 配置 MDX 支持
3. k01_create_layout     - 创建基础布局组件
4. k01_article_list      - 实现文章列表页
5. k01_article_detail    - 实现文章详情页

技术栈: TypeScript, Next.js, TailwindCSS (基于你的画像)

是否继续生成?
[确认] [调整] [取消]
```

### 第四步：使用子技能

确认后，系统批量生成子技能，然后可以逐个使用：

```
/k01_init_project     # 执行步骤 1
/k01_config_mdx        # 执行步骤 2
/k01_create_layout     # 执行步骤 3
...
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
      "created_at": "2026-01-27T16:00:00Z"
    }
  }
}
```

## 已生成任务

*(此部分会在生成第一个任务后自动更新)*

## 常用命令

| 命令 | 功能 |
|------|------|
| `/user-profile` | 重新生成用户画像 |
| `/new-skill [任务]` | 创建任务并生成子技能 |
| `/k[任务]_[步骤]` | 使用指定的子技能 |

## 文件格式支持

`info/` 目录支持多种文件格式：

| 格式 | 用途 | 示例 |
|------|------|------|
| `.md` | 个人自述、文档 | bio.md, goals.md |
| `.json` | 结构化配置 | preferences.json |
| `.pdf` | 简历、文档 | resume.pdf |
| `.txt` | 笔记、随笔 | notes.txt |

## 更新与维护

### 更新用户画像
修改 `info/` 下的文件后，运行 `/user-profile` 重新生成。

### 查看所有子技能
`ls .claude/skills/` 查看所有生成的子技能。

### 删除任务
删除任务对应的所有子技能目录即可：
```bash
rm -rf .claude/skills/k01_*
```

### 任务状态
在 `tasks.json` 中修改 `status` 字段：
- `active`: 进行中
- `completed`: 已完成
- `archived`: 已归档

## 设计理念

- **任务驱动**: 以任务为中心，拆解为可执行的子技能
- **简单优先**: 核心流程清晰，不引入过多抽象
- **增量迭代**: 每个子技能完成一步，逐步推进
- **以人为本**: 围绕用户画像定制 AI 行为
