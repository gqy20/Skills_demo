# Skills Demo System 使用指南

这是一个基于 Claude Code Skills 的个人 AI 辅助开发系统，通过用户画像和任务驱动的技能生成，提供定制化的开发帮助。

## 系统概述

```
用户信息 (info/) → 用户画像 (.info/usr.json)
                                  ↓
任务输入 (/new-skill) → 定制化 Skill (.claude/skills/k01_article_search/)
```

## 核心概念

### 1. 用户画像 (User Profile)
系统根据 `info/` 目录下的文件自动生成用户画像，包含：
- **基础信息**: 姓名、角色、经验等级
- **技术栈**: 语言、框架、工具
- **偏好风格**: 代码风格、沟通方式
- **行为模式**: 工作风格、协作偏好
- **目标痛点**: 学习方向、常见问题

### 2. 任务编号 (Task ID)
每个任务自动分配唯一编号：`k01`, `k02`, `k03`...
- 便于管理和追溯
- 自动递增，无需手动指定

### 3. 技能生成 (Skill Generation)
根据任务 + 用户画像，生成定制化的 Skill：
- 使用用户熟悉的技术栈
- 遵循用户的代码风格
- 适配用户的工作习惯
- 避开用户的已知痛点

**命名格式**: `k01_task_name`（编号_任务描述）

## 目录结构

```
.
├── .claude/
│   ├── settings.json           # Claude Code 配置
│   └── skills/
│       ├── user-profile/       # 用户画像生成技能
│       ├── skill-generator/    # 技能生成器
│       ├── k01_nextjs_blog/    # 生成的技能
│       └── k02_article_search/ # 生成的技能
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

### 第二步：为任务生成 Skill

当有新任务时，使用：
```
/new-skill [任务描述]
```

例如：
```
/new-skill 搭建 Next.js 博客
/new-skill 文章搜索功能
/new-skill Git 工作流自动化
```

系统会：
1. 读取用户画像
2. 分配任务编号（如 k01）
3. 从描述中提取关键词生成标识符（如 `k01_nextjs_blog`）
4. 生成定制化的 Skill
5. 保存到 `.claude/skills/k01_nextjs_blog/SKILL.md`

### 第三步：使用生成的 Skill

生成的 Skill 可以直接使用：
```
/k01_nextjs_blog
```

## 命名规则

| 任务描述 | 生成的 Skill 目录 |
|---------|------------------|
| 搭建 Next.js 博客 | `k01_nextjs_blog` |
| 文章搜索功能 | `k02_article_search` |
| Git 工作流自动化 | `k03_git_automation` |
| TypeScript CLI 工具 | `k04_ts_cli_tool` |

命名格式：`k[编号]_[关键词]`
- 编号自动递增
- 使用英文小写
- 用下划线连接

## 完整示例

### 场景：搭建博客

```bash
# 1. 准备用户信息（已配置）

# 2. 生成用户画像
/user-profile
# → 生成 .info/usr.json

# 3. 为博客任务生成 Skill
/new-skill 搭建 Next.js 博客
# → 生成 .claude/skills/k01_nextjs_blog/SKILL.md
# → 更新 .info/tasks.json

# 4. 使用生成的 Skill
/k01_nextjs_blog
# → 获得定制化的开发指导
```

### 生成结果

`.claude/skills/k01_nextjs_blog/SKILL.md` 会包含：
- 使用 TypeScript（你熟悉的语言）
- 迭代式开发步骤（符合你的工作风格）
- 代码优先响应（你的偏好）
- 注意类型推导问题（避开你的痛点）

## tasks.json 结构

```json
{
  "next_id": 3,
  "tasks": {
    "k01_nextjs_blog": {
      "id": "k01_nextjs_blog",
      "name": "搭建 Next.js 博客",
      "description": "基于 Next.js 的个人博客系统",
      "created_at": "2026-01-27T15:00:00Z"
    },
    "k02_article_search": {
      "id": "k02_article_search",
      "name": "文章搜索功能",
      "description": "实现全文搜索功能",
      "created_at": "2026-01-27T15:10:00Z"
    }
  }
}
```

## 常用命令

| 命令 | 功能 |
|------|------|
| `/user-profile` | 重新生成用户画像 |
| `/new-skill [任务]` | 为任务生成定制化 Skill |
| `/k[编号]_[名称]` | 使用生成的 Skill |

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

### 查看所有 Skill
`ls .claude/skills/` 查看所有生成的技能。

### 删除 Skill
删除对应的 `.claude/skills/k[编号]_[名称]/` 目录即可。

## 设计理念

- **简单优先**: 核心流程清晰，不引入过多抽象
- **增量迭代**: 先可用，再完善
- **以人为本**: 围绕用户画像定制 AI 行为
- **可扩展**: 易于添加新的 Skills 和功能
