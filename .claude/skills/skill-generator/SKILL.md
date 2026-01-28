---
name: skill-generator
description: 根据用户任务和画像，将任务拆解为步骤并生成子技能。使用场景：(1) 指挥官创建新任务时调用，(2) 用户请求任务拆解时使用，(3) 复杂任务需要分解时使用。
---

# 技能生成器

将用户任务拆解为可执行的子技能，每个步骤生成独立的技能。

## 处理流程

### 任务模式 (k_ 前缀)

1. 读取用户画像 `.info/usr.json`
2. 分配任务编号（k01, k02, ...）
3. 分析任务类型，详见 [任务类型](references/task-types.md)
4. 拆解为 2-10 个步骤
5. 为每个步骤生成子技能
6. 创建 `results/k01/` 目录和文件
7. 更新 `.info/tasks.json`

### 经验模式 (u_ 前缀)

1. 读取用户画像中的 `experience` 维度
2. 为每个经验生成 `u_` 前缀技能
3. 技能内容包含：执行流程、最佳实践、踩坑记录
4. 更新 `.info/tasks.json` 的 `user_skills` 字段

## 子技能命名

详见 [命名规范](references/naming-conventions.md)：

### 任务模式 (k_ 前缀)

| 类型 | 模式 | 示例 |
|------|------|------|
| 初始化 | `k[任务]_init_[项目]` | k01_init_project |
| 配置 | `k[任务]_config_[功能]` | k01_config_mdx |
| 创建 | `k[任务]_create_[组件]` | k01_create_layout |
| 实现 | `k[任务]_[功能]` | k01_article_list |
| 修复 | `k[任务]_fix_[问题]` | k01_fix_routing |

### 经验模式 (u_ 前缀)

| 类型 | 模式 | 示例 |
|------|------|------|
| 项目经验 | `u_[项目]` | u_blog_mdx |
| 技术栈经验 | `u_[技术]` | u_react_hooks |
| 工具经验 | `u_[工具]` | u_docker_compose |

## 输出结构

```
.claude/skills/
├── u_blog_mdx/SKILL.md       # 用户经验技能
├── u_react_hooks/SKILL.md    # 用户经验技能
├── k01_init_project/SKILL.md # 任务子技能
├── k01_config_mdx/SKILL.md
└── k01_create_layout/SKILL.md

results/k01/
├── README.md        # 任务总览
├── plan.md          # 任务计划
├── execution.md     # 执行记录
├── notes.md         # 笔记
└── artifacts/       # 生成的文件
```

## u_ 前缀技能的内容结构

```markdown
---
name: u_blog_mdx
description: 使用 Next.js + MDX 构建博客的已验证方案。包含：初始化配置、MDX 集成、动态路由、SSG、代码高亮。当用户需要搭建博客、文档站点、内容管理系统时使用。
---

# u_blog_mdx

使用 Next.js App Router + MDX 构建博客的执行方案。

## 执行流程

### 1. 初始化项目
```bash
npx create-next-app@latest blog --typescript --tailwind --app
```

### 2. 安装依赖
...

## 最佳实践

| 实践 | 说明 |
|-----|------|
| SSG | 使用 generateStaticParams 预渲染 |
| 代码高亮 | rehype-prism-plus |

## 已知坑点

| 问题 | 解决方案 |
|-----|---------|
| MDX 组件报错 | 声明 'use client' |
| 远程图片不显示 | 配置 images.domains |

## 关联项目
- k01: 搭建 Next.js 博客（2025-01）
```

## tasks.json 结构

```json
{
  "next_id": 2,
  "tasks": {
    "k01": {
      "id": "k01",
      "name": "任务名称",
      "type": "web",
      "status": "active",
      "steps": ["k01_init_project", "k01_config_mdx", ...],
      "current_step": 0,
      "created_at": "2026-01-27T16:00:00Z"
    }
  },
  "user_skills": {
    "u_blog_mdx": {
      "name": "Next.js MDX 博客",
      "level": "proficient",
      "created_at": "2026-01-28T10:00:00Z",
      "related_tasks": ["k01"]
    }
  }
}
```

## 基于画像的定制

生成的子技能会根据用户画像定制：

| 画像字段 | 用途 |
|---------|------|
| `tech_stack.primary_languages` | 使用熟悉的编程语言 |
| `preferences.code_style` | 遵循命名和格式规范 |
| `preferences.response_format` | 适配代码优先/解释优先 |
| `behavioral_patterns.work_style` | 采用迭代式/规划式开发 |
| `goals.pain_points` | 避开已知的技术难点 |

## 错误处理

| 场景 | 处理方式 |
|------|---------|
| 用户画像不存在 | 提示运行 `/user-profile` |
| 步骤少于 2 个 | 任务过于简单，可直接执行 |
| 步骤多于 10 个 | 任务过于复杂，建议拆分为多个任务 |
| 用户取消生成 | 恢复 tasks.json 的 next_id |
