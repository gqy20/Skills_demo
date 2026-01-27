# Skill 生成器 (Skill Generator)

根据用户任务和用户画像，通过**任务拆解→子技能生成**的流程，为每个步骤创建独立的 Skill。

## 核心概念

```
任务 k01 (搭建 Next.js 博客)
    ↓ 拆解为 5 个步骤
    ├─ k01_init_project       (初始化项目)
    ├─ k01_config_mdx          (配置 MDX)
    ├─ k01_create_layout       (创建布局)
    ├─ k01_article_list        (文章列表页)
    └─ k01_article_detail      (文章详情页)

每个步骤 = 一个独立的 Skill
```

---

## 核心流程

```
用户输入任务 → 读取画像 → 分配任务编号 → 拆解步骤
→ 为每步生成 Skill → 用户确认 → 批量生成 → 更新文档
```

---

## 阶段 1: 读取画像与分配任务编号

### 1.1 读取用户画像
读取 `.info/usr.json`，提取关键信息。

### 1.2 分配任务编号
- 读取 `.info/tasks.json`
- 获取 `next_id`（如 1）
- 生成**任务编号** `k01`
- 更新 `next_id += 1`

### 1.3 任务元数据
```
任务编号: k01
任务名称: 搭建 Next.js 博客
任务类型: web
创建时间: 2026-01-27T16:00:00Z
```

---

## 阶段 2: 拆解任务为步骤

### 2.1 分析任务类型
- **web**: Web 应用开发
- **cli**: 命令行工具
- **api**: API 开发
- **tool**: 开发工具/脚本
- **config**: 配置管理

### 2.2 拆解执行步骤
将任务分解为具体步骤，每步生成一个子技能。

| 步骤 | 子技能标识符 | 描述 |
|------|-------------|------|
| 步骤 1 | `k01_init_project` | 初始化 Next.js 项目 |
| 步骤 2 | `k01_config_mdx` | 配置 MDX 支持 |
| 步骤 3 | `k01_create_layout` | 创建基础布局 |
| 步骤 4 | `k01_article_list` | 实现文章列表页 |
| 步骤 5 | `k01_article_detail` | 实现文章详情页 |

---

## 阶段 3: 为每个步骤规划 Skill

为每个步骤生成 Skill 内容：

### k01_init_project
```markdown
# 初始化 Next.js 项目 (k01_init_project)

## 本步骤目标
使用 TypeScript 和 TailwindCSS 创建 Next.js 项目

## 执行命令
\`\`\`bash
npx create-next-app@latest blog --typescript --tailwind --eslint
\`\`\`

## 代码规范
- 命名: camelCase
- 格式: Prettier + ESLint
```

### k01_config_mdx
```markdown
# 配置 MDX 支持 (k01_config_mdx)

## 本步骤目标
添加 @next/mdx 支持，使博客能使用 Markdown 写作

## 安装依赖
\`\`\`bash
npm install @next/mdx @mdx-js/loader @mdx-js/react
\`\`\`

## 配置文件
修改 next.config.js...
```

... (其他步骤类似)

---

## 阶段 4: 展示计划并确认

### 4.1 展示完整计划

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

定制化:
- 代码风格: camelCase, Prettier + ESLint
- 响应方式: 代码优先
- 注意事项: 避开类型推导复杂度

═══════════════════════════════════════════════════════

是否继续生成?
[确认] [调整] [取消]
```

### 4.2 处理用户反馈
- **确认**: 批量生成所有子技能
- **调整**: 修改步骤列表后再次确认
- **取消**: 终止流程

---

## 阶段 5: 批量生成 Skills

### 5.1 创建目录结构
```
.claude/skills/
├── k01_init_project/
│   └── SKILL.md
├── k01_config_mdx/
│   └── SKILL.md
├── k01_create_layout/
│   └── SKILL.md
├── k01_article_list/
│   └── SKILL.md
└── k01_article_detail/
    └── SKILL.md
```

### 5.2 生成每个 SKILL.md
基于用户画像和步骤规划，生成每个独立的 Skill 文件。

### 5.3 更新 tasks.json
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

---

## 阶段 6: 更新文档

### 6.1 更新 USAGE.md
在 "命名规则" 表格后添加：

```markdown
## 已生成任务

| 任务 | 步骤数 | 子技能列表 | 状态 |
|------|--------|-----------|------|
| k01 | 5 | k01_init_project, k01_config_mdx, ... | active |

### 任务 k01: 搭建 Next.js 博客

| 子技能 | 描述 | 使用命令 |
|--------|------|---------|
| k01_init_project | 初始化 Next.js 项目 | `/k01_init_project` |
| k01_config_mdx | 配置 MDX 支持 | `/k01_config_mdx` |
| k01_create_layout | 创建基础布局组件 | `/k01_create_layout` |
| k01_article_list | 实现文章列表页 | `/k01_article_list` |
| k01_article_detail | 实现文章详情页 | `/k01_article_detail` |
```

### 6.2 更新 CLAUDE.md
在 "目录结构" 中添加：
```
.claude/skills/
├── k01_init_project/
├── k01_config_mdx/
└── ...
```

---

## 完整示例流程

```
用户: /new-skill 搭建一个 Next.js 博客

[系统] 读取用户画像...
       → 林远 | TypeScript/Python | 迭代式开发 | 代码优先

[系统] 分配任务编号: k01

[系统] 分析任务类型: web

[系统] 拆解步骤...
       → 5 个步骤

═══════════════════════════════════════════════════════
任务: 搭建 Next.js 博客
编号: k01
═══════════════════════════════════════════════════════

将生成 5 个子技能:

1. k01_init_project     - 初始化项目
2. k01_config_mdx        - 配置 MDX
3. k01_create_layout     - 创建布局
4. k01_article_list      - 文章列表页
5. k01_article_detail    - 文章详情页

技术栈: TypeScript, Next.js (基于你的画像)

是否继续生成?
[确认] [调整] [取消]

[用户] 确认

[系统] 批量生成 Skills...
       ✓ k01_init_project
       ✓ k01_config_mdx
       ✓ k01_create_layout
       ✓ k01_article_list
       ✓ k01_article_detail

[系统] 更新文档...
       ✓ tasks.json
       ✓ USAGE.md
       ✓ CLAUDE.md

✓ 任务 k01 完成！使用 /k01_xxx 启动各个步骤
```

---

## 子技能命名规范

| 步骤类型 | 命名模式 | 示例 |
|---------|---------|------|
| 初始化 | `k[任务]_init_[项目]` | k01_init_project |
| 配置 | `k[任务]_config_[功能]` | k01_config_mdx |
| 创建 | `k[任务]_create_[组件]` | k01_create_layout |
| 实现 | `k[任务]_[feature]` | k01_article_list |
| 修复 | `k[任务]_fix_[问题]` | k01_fix_routing |
| 测试 | `k[任务]_test_[模块]` | k01_test_api |

---

## 使用方式
```
/new-skill [任务描述]
```

例如：
- `/new-skill 搭建 Next.js 博客`
- `/new-skill 实现用户认证系统`
- `/new-skill 编写 API 接口`

---

## 错误处理

| 场景 | 处理方式 |
|------|---------|
| 用户画像不存在 | 提示运行 `/user-profile` |
| tasks.json 损坏 | 重建为默认格式 |
| 用户取消生成 | 恢复 tasks.json 的 next_id |
| 步骤少于 2 个 | 提示任务过于简单 |
| 步骤多于 10 个 | 提示任务过于复杂，建议拆分 |
