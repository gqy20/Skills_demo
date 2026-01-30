---
name: user-profile
description: 分析 info/ 目录下的用户文件，生成结构化用户画像。使用场景：(1) 首次使用时创建画像，(2) 修改 info/ 文件后刷新画像，(3) 指挥官检测到画像过期时自动触发，(4) 用户问"我是谁"时智能响应。
---

# 用户画像生成

分析 `info/` 目录中的用户文件，生成结构化用户画像。

## 角色定位

**user-profile 是纯数据生产者**，专注于从原始数据提取用户信息。

### 职责边界

| ✅ 应该做 | ❌ 不应该做 |
|---------|-----------|
| 读取 info/ 目录的原始文件 | 读取 tasks.json |
| 分析文件内容提取用户信息 | 检查任务状态 |
| 生成 .info/usr.json | 管理任务生命周期 |
| 检测文件变化判断是否需要更新 | 直接生成 k_ 技能（任务技能） |
| 响应用户的身份查询（"我是谁"） | 越权生成技能 |
| 画像确认后**可选调用** skill-generator 生成 u_ 技能 | 强制自动生成技能 |

### 与其他 Skills 的关系

```
┌─────────────┐
│ user-profile │ (数据生产者)
└──────┬──────┘
       │ 输出: .info/usr.json
       │
       ├─────────────────────┐
       │                     │
       ↓ (可选，用户确认后)   ↓
┌───────────────┐    ┌─────────────┐
│skill-generator │    │  commander   │
│  (u_ 技能)     │    │ (任务调度)   │
└───────────────┘    └─────────────┘
```

- **对 commander**：被动提供画像数据
- **对 skill-generator**：
  - 只读：提供画像数据供 skill-generator 分析
  - 可选触发：用户确认画像后，**可询问**是否生成 u_ 技能
  - 不参与：k_ 技能（任务技能）的生成由 commander 调用
- **独立性**：可独立运行，生成 u_ 技能是可选项

## 使用模式

### 模式 1：手动调用

用户主动运行 `/user-profile` 命令，直接生成/更新画像。

### 模式 2：智能触发（身份查询）

当用户问以下问题时，自动触发智能响应：

| 中文 | 英文 |
|-----|------|
| "我是谁" | "Who am I" |
| "我的画像" | "My profile" |
| "我的信息" | "My information" |
| "看看我的资料" | "Show my profile" |

**智能响应流程**：

```
用户问 "我是谁"
    ↓
检查 .info/usr.json 状态
    ↓
┌─────────────────────────────────────────────────────────────┐
│ 画像不存在                                                   │
│ → AskUserQuestion: "用户画像不存在，是否立即生成？"         │
│   - [生成] → 执行画像生成流程                                │
│   - [跳过] → 提示稍后运行 /user-profile                      │
└─────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────┐
│ 画像存在，但 info/ 有新文件                                  │
│ → AskUserQuestion: "检测到新文件，是否更新画像？"            │
│   - [更新] → 执行画像生成流程                                │
│   - [查看] → 显示当前画像摘要                                │
└─────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────┐
│ 画像最新                                                     │
│ → 直接显示画像摘要                                           │
└─────────────────────────────────────────────────────────────┘
```

**画像摘要格式**：

```markdown
## 用户画像

**基本信息**
- 姓名: {name}
- 角色: {role}
- 经验: {experience_level}

**技术栈**
- 主语言: {primary_languages}
- 框架: {frameworks}

**当前焦点**
- {current_focus}

**掌握技能**
- {count} 个用户技能

---
如需更新画像，运行: /user-profile
```

## 支持的文件格式

| 格式 | 用途 | 详情 |
|------|------|------|
| `.md` | 个人自述、文档、对话记录 | 详见 [文件格式说明](references/) |
| `.json` | 结构化配置 | 详见 [文件格式说明](references/) |
| `.pdf` | 简历、文档 | 使用 `scripts/extract_pdf.py` 提取 |
| `.txt` | 笔记、随笔 | 详见 [文件格式说明](references/) |

### 对话记录分析

**特殊文件类型**：AI 对话记录（如 Continue.dev、Cursor、Claude Code 的会话导出）

#### 识别特征

文件包含以下模式时识别为对话记录：
- `#### _User_` / `#### _Assistant_` 或类似标记
- `### [Continue]` / `### [Cursor]` 等工具名称
- `>` 引用格式的 AI 回复

#### 提取维度

| 维度 | 提取内容 | 示例指标 |
|-----|---------|---------|
| **专业领域** | 对话主题、项目类型 | AI4S 研究、Web 开发、数据分析 |
| **使用工具** | AI 工具、开发环境 | Continue.dev、Cursor、VS Code |
| **工作模式** | 与 AI 协作方式 | 迭代式优化、多轮对话、代码生成 |
| **沟通风格** | 提问方式、反馈习惯 | 简洁指令 vs 详细说明、是否追问细节 |
| **关注重点** | 常用词汇、请求类型 | 项目申报、代码实现、文档撰写 |
| **技术栈** | 讨论的技术内容 | Python、Mermaid、Markdown、特定框架 |
| **输出偏好** | 常请求的输出格式 | Markdown 文件、Mermaid 图表、PPT 提纲 |

#### 分析规则

```yaml
conversation_analysis:
  # 用户行为模式识别
  behavior_patterns:
    iterative_refinement:  # 迭代优化模式
      indicator: "多次相似请求，逐步完善需求"
      example: ["生成", "继续", "优化", "修改"]
    code_first:           # 代码优先模式
      indicator: "直接请求代码实现"
      example: ["实现", "写一个", "生成代码"]
    documentation_first:  # 文档优先模式
      indicator: "重视文档和说明"
      example: ["文档", "说明", "注释", "README"]

  # 专业领域识别
  domain_detection:
    keywords:
      research: ["研究", "项目申报", "课题", "框架", "范式"]
      development: ["实现", "部署", "调试", "优化"]
      design: ["设计", "UI", "交互", "体验"]

  # 工具栈识别
  tool_detection:
    ai_tools: ["Continue", "Cursor", "Claude", "Copilot"]
    dev_tools: ["VS Code", "Typora", "Git", "Docker"]
    formats: ["Markdown", "Mermaid", "JSON", "YAML"]
```

## 画像结构

用户画像包含以下维度，详见 [维度详细说明](references/dimensions.md)：

- **basic_info**: 姓名、角色、经验等级
- **tech_stack**: 语言、框架、工具
- **preferences**: 代码风格、沟通方式
- **behavioral_patterns**: 工作风格、协作偏好
- **goals**: 当前焦点、痛点、志向
- **experience**: 项目经验的可执行化方案
- **conversation_patterns**: 从对话记录中提取的行为模式（新增）
  - `ai_tools`: 使用的 AI 工具（Continue、Cursor、Claude 等）
  - `collaboration_style`: 与 AI 协作的风格（iterative、direct、exploratory）
  - `output_preferences`: 偏好的输出格式（markdown、diagram、code）
  - `conversation_domains`: 对话中体现的专业领域
- **metadata**: 版本、时间戳、源文件

## 处理流程

1. 扫描 `info/` 目录所有文件
2. **检测对话记录**：识别 AI 对话记录文件（Continue、Cursor 等）
3. **分析对话记录**：
   - 提取专业领域和关注重点
   - 识别使用工具和技术栈
   - 分析工作模式和沟通风格
4. **PDF 文件处理**：
   - 检测 `.pdf` 文件
   - 使用 Python 脚本提取文本内容：
     ```bash
     python3 .claude/skills/user-profile/scripts/extract_pdf.py "文件路径.pdf"
     ```
   - 解析返回的 JSON（包含 text、pages、metadata）
   - 按简历类/文档类/表格类识别并提取信息
5. 按类型提取其他文件信息，详见 [提取规则](references/extraction-rules.md)
6. 合并多源信息（对话记录 + PDF + 其他文件）
7. 提取项目经验并生成可执行化方案
8. 生成结构化 JSON
9. **用户确认**：展示画像摘要，等待用户确认
10. 保存到 `.info/usr.json`

### 对话记录分析示例

```
分析 note.md (Continue.dev 会话记录):
├─ 识别类型: AI 对话记录
├─ 专业领域: AI4S 研究、科研管理
├─ 使用工具: Continue.dev、Mermaid、VS Code、Typora
├─ 工作模式: 迭代式与 AI 协作，多轮完善内容
├─ 沟通风格: 简洁指令 + 请求文件输出
├─ 关注重点: 项目申报书、研究框架、可视化图表
└─ 补充画像: behavioral_patterns.work_style = "iterative_ai_collaboration"
```

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

## 用户确认流程

生成用户画像后，必须使用 AskUserQuestion 获取用户确认。

### 确认时机

| 场景 | 确认内容 |
|-----|---------|
| 首次生成画像 | 确认基本信息、技术栈、经验准确性 |
| 重大更新 | 确认新增/变更的内容 |
| u_ 技能超限 | 选择归档策略 |

### 确认流程

#### 第一步：确认画像准确性

```
用户画像已生成，请确认准确性：

┌─────────────────────────────────────────┐
│ 基本信息                                │
├─────────────────────────────────────────┤
│ 角色: 全栈开发工程师                    │
│ 经验等级: 中级                          │
│ 主要语言: TypeScript, Python            │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ 识别到的项目经验 (3个)                  │
├─────────────────────────────────────────┤
│ ✅ Next.js MDX 博客                     │
│ ✅ FastAPI CRUD 服务                    │
│ ✅ Docker 容器化部署                    │
└─────────────────────────────────────────┘

是否接受此画像？
- 接受
- 拒绝，修正后重新生成
```

#### 第二步：询问是否生成 u_ 技能（仅在用户确认画像后）

当用户选择"接受"后，**可选**询问是否生成 u_ 技能：

```
┌─────────────────────────────────────────┐
│ 画像已保存到 .info/usr.json              │
└─────────────────────────────────────────┘

是否立即将项目经验转化为 u_ 技能？

┌─────────────────────────────────────────┐
│ 拟生成的 u_ 技能 (3个)                  │
├─────────────────────────────────────────┤
│ u_next_mdx        - Next.js + MDX 博客  │
│ u_fastapi_crud    - FastAPI CRUD 服务   │
│ u_docker_deploy   - Docker 容器化部署   │
└─────────────────────────────────────────┘

选择下一步：
- 立即生成 u_ 技能 → 调用 Skill("skill-generator", "--mode=experience")
- 稍后手动生成 → 保存画像，稍后可运行 /skill-generator experience
- 跳过 → 不生成 u_ 技能
```

#### 调用 skill-generator 的方式

当用户选择"立即生成 u_ 技能"时，使用以下方式调用：

```python
# 使用 Skill tool 调用 skill-generator 的经验模式
Skill("skill-generator", "--mode=experience")
```

skill-generator 会：
1. 读取 usr.json.experience[] 中的经验数据
2. 评估每个经验的价值
3. 生成 u_ 前缀技能文件
4. 更新 tasks.json.user_skills

### u_ 技能超限确认

当识别到超过 5 个高价值经验时：

```
当前有 6 个 u_ 技能，超过 5 个上限。

需要归档 1 个技能，请选择：

┌─────────────────────────────────────────┐
│ 技能名称              使用次数  最后使用 │
├─────────────────────────────────────────┤
│ u_old_react_classic   0        3个月前  │
│ u_express_basic       1        2个月前  │
└─────────────────────────────────────────┘

选择归档策略：
- 自动：归档最少使用的 u_old_react_classic
- 手动：让我选择归档哪个
- 取消：保持现状（不生成新 u_ 技能）
```
