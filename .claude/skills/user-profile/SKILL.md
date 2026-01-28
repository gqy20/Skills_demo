---
name: user-profile
description: 分析 info/ 目录下的用户文件，生成结构化用户画像。使用场景：(1) 首次使用时创建画像，(2) 修改 info/ 文件后刷新画像，(3) 指挥官检测到画像过期时自动触发。
---

# 用户画像生成

分析 `info/` 目录中的用户文件，生成结构化用户画像。

## 支持的文件格式

| 格式 | 用途 | 详情 |
|------|------|------|
| `.md` | 个人自述、文档 | 详见 [文件格式说明](references/) |
| `.json` | 结构化配置 | 详见 [文件格式说明](references/) |
| `.pdf` | 简历、文档 | 详见 [文件格式说明](references/) |
| `.txt` | 笔记、随笔 | 详见 [文件格式说明](references/) |

## 画像结构

用户画像包含以下维度，详见 [维度详细说明](references/dimensions.md)：

- **basic_info**: 姓名、角色、经验等级
- **tech_stack**: 语言、框架、工具
- **preferences**: 代码风格、沟通方式
- **behavioral_patterns**: 工作风格、协作偏好
- **goals**: 当前焦点、痛点、志向
- **experience**: 项目经验的可执行化方案
- **metadata**: 版本、时间戳、源文件

## 处理流程

1. 扫描 `info/` 目录所有文件
2. 按类型提取信息，详见 [提取规则](references/extraction-rules.md)
3. 合并多源信息
4. 提取项目经验并生成可执行化方案
5. 生成结构化 JSON
6. 保存到 `.info/usr.json`

## 经验提取 (experience)

从用户的项目经验中提取可执行化的执行方案，用于生成 `u_` 前缀技能。

**数量控制**：`u_` 技能总数保持在 **5 个以内**，只保留高价值经验。

### 价值评估标准

| 维度 | 高价值 | 低价值 |
|-----|-------|-------|
| 通用性 | 可复用到多种场景 | 仅限单一场景 |
| 独特性 | 有独特的最佳实践 | 常规操作 |
| 完整性 | 有完整的执行方案 | 片段化经验 |
| 复杂度 | 涉及多技术整合 | 简单操作 |

### 经验结构

```json
{
  "experience": [
    {
      "project": "Next.js MDX 博客",
      "skill_id": "u_blog_mdx",
      "tech_stack": ["Next.js 15", "MDX", "Tailwind"],
      "executable_approach": {
        "step_1": "使用 create-next-app 初始化，选择 App Router",
        "step_2": "安装 @mdx-js/loader + @next/mdx",
        "step_3": "配置 next.config.js 的 webpack 用于 MDX",
        "step_4": "创建 app/blog/[slug]/page.tsx 动态路由",
        "step_5": "使用 fs 读取 MDX 文件，配合 gray-matter 解析 frontmatter"
      },
      "best_practices": [
        "使用 generateStaticParams 实现 SSG",
        "代码高亮用 rehype-prism-plus",
        "远程图片配置 images.domains"
      ],
      "avoid_pitfalls": [
        "MDX 组件必须在客户端组件中声明 'use client'",
        "next/image 远程图片需要配置域名白名单"
      ],
      "related_tasks": ["k01"]
    }
  ]
}
```

### 提取策略

| 信息类型 | 提取方式 | 输出字段 |
|---------|---------|---------|
| 项目名称 | 从简历、项目文档中识别 | `project` |
| 技术栈 | 项目中使用的框架、语言 | `tech_stack` |
| 执行步骤 | 项目实施的关键步骤 | `executable_approach` |
| 最佳实践 | 成功的经验和模式 | `best_practices` |
| 踩坑记录 | 遇到的问题和解决方案 | `avoid_pitfalls` |

## 输出示例

```json
{
  "basic_info": {},
  "tech_stack": {},
  "preferences": {},
  "behavioral_patterns": {},
  "goals": {},
  "metadata": {
    "version": "1.0.0",
    "generated_at": "2026-01-27T16:00:00Z",
    "last_checked_at": "2026-01-27T16:00:00Z",
    "source_files": ["info/bio.md", ...],
    "source_mtimes": {},
    "confidence": "high"
  }
}
```

## 错误处理

| 场景 | 处理方式 |
|------|---------|
| `info/` 为空 | 提示用户添加文件 |
| 画像已存在 | 合并更新而非覆盖 |
| 冲突处理 | 优先使用最新修改的文件 |
| u_ 技能超过 5 个 | 提示用户归档低频经验 |

## 数量控制

- **k_ 技能**：每个任务生成 2-3 个，聚焦核心能力
- **u_ 技能**：总数保持在 5 个以内，只保留高价值经验
- **归档策略**：低频 u_ 技能移至 `results/archived/u_skills/`
