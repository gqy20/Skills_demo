---
name: skill-generator
description: 根据用户任务和画像，分析所需能力并生成子技能。使用场景：(1) 指挥官创建新任务时调用，(2) user-profile 确认后可选调用生成 u_ 技能，(3) 用户请求技能分析时使用。每个任务生成 2-3 个核心 k_ 技能，u_ 技能总数保持在 5 个以内。
---

# 技能生成器

分析任务所需能力，生成可复用的技能单元。

**核心原则**：聚焦核心能力，避免过度拆解。

## 角色定位

**skill-generator 是技能分析师**，专注于任务分析和技能生成。

### 职责边界

| ✅ 应该做 | ❌ 不应该做 |
|---------|-----------|
| 分析任务描述，识别所需能力 | 管理任务状态（active/completed） |
| 读取 .info/usr.json 获取用户画像 | 直接修改 tasks.json |
| 生成技能文件（SKILL.md） | 创建任务结果目录 |
| 决定生成哪些技能及数量 | 协调技能执行顺序 |
| 从画像中提取经验生成 u_ 技能 | 检查用户画像新鲜度 |
| 返回技能列表给调用者 | 执行生成的技能 |

> **说明**：tasks.json 的更新由 `track-skills-change.sh` hook 自动完成，skill-generator 不直接操作。

### 与其他 Skills 的关系

```
                    ┌─────────────────────────────────────────┐
                    │          skill-generator                │ (技能分析师)
                    │  ┌───────────────────────────────────┐  │
                    │  │ 输入: 任务描述 + .info/usr.json    │  │
                    │  │ 输出: k_ 技能文件 + u_ 技能文件    │  │
                    │  └───────────────────────────────────┘  │
                    └────────────────▲────────▲────────────────┘
                                     │        │
                           ┌─────────┴──┐    ┌┴──────────┐
                           ↓            ↓    ↓           ↓
                   ┌───────────────┐    ┌──────────────┐
                   │ user-profile  │    │  commander   │
                   │ (可选调用)    │    │  (主调用者)  │
                   │ u_ 技能生成   │    │  k_ 技能生成 │
                   └───────────────┘    └──────────────┘
```

- **对 user-profile**：
  - 只读画像数据，不修改
  - 可被 user-profile 调用（经验模式）：生成 u_ 技能
- **对 commander**：接收任务描述，返回技能列表（任务模式）
- **独立性**：不管理任务生命周期，只负责分析
- **输出格式**：返回标准化的技能列表供调用者使用

## 调用方式

### 任务模式（由 commander 调用）

**commander → skill-generator 交互流程**：

```
1. 用户运行: /commander start [任务描述]
2. commander 检查用户画像
3. commander 调用: Skill("skill-generator", 任务描述)
4. skill-generator 分析任务并返回分析结果
5. 【第一次确认】AskUserQuestion 确认分析结果
6. skill-generator 规划技能并返回技能计划
7. 【第二次确认】AskUserQuestion 确认技能计划
8. 用户确认后，skill-generator 创建技能文件
9. hook 系统自动注册到 tasks.json
```

**输入格式**：
- 任务描述（自然语言）
- 用户画像（自动读取 `.info/usr.json`）

**输出格式**：
- 技能生成计划（供用户确认）
- 技能文件（`.claude/skills/k[0-9]_*/SKILL.md`）

### 经验模式（由 user-profile 调用）

**user-profile → skill-generator 交互流程**：

```
1. 用户运行: /user-profile
2. user-profile 分析 info/ 目录
3. user-profile 可选调用: Skill("skill-generator", "--mode=experience")
4. skill-generator 返回: u_ 技能生成计划
5. 用户确认后生成 u_ 技能
```

**输入格式**：
- 模式标识：`--mode=experience`
- 用户画像的 experience 维度

**输出格式**：
- u_ 技能文件（`.claude/skills/u_*/SKILL.md`）

### 直接调用（用户手动）

用户也可以直接调用进行分析：

```
/skill-generator 分析"搭建 Next.js 博客"需要的技能
```

## 处理流程

### 任务模式 (k_ 前缀) - 技能分析

**原则**：每个任务生成 **2-3 个 k_ 技能**作为步骤

```
任务步骤列表 = k_ 技能（2-3 个）

k_ 技能生成时参考：
├── p_ 技能（验证技能）→ 优先参考其内容
├── u_ 技能（用户经验）→ 其次参考其内容
└── 能力空白 → 创建新内容
```

1. 读取用户画像 `.info/usr.json`
2. 分配任务编号（k01, k02, ...）
3. 分析任务所需的核心能力
   - **识别关键技术点**：框架、语言、工具、领域知识
   - **检查 p_ 技能池**：查找已验证的参考技能（最多10个）
   - **检查 u_ 技能池**：查找用户经验技能（最多5个）
   - **确定能力空白**：找出需要创建的新技能
   - **📝 输出推理块**：将分析过程写入 `results/k01/.reasoning.md`（自动合并到全局日志）
4. **【第一次确认】分析结果确认**：使用 AskUserQuestion 确认分析结果
   - 展示：任务类型、技术栈、复杂度评估
   - 展示：匹配到的参考技能（p_ 技能、u_ 技能）
   - 展示：识别的能力空白
5. **技能生成规划**：确定生成 2-3 个 k_ 技能的方案
   - **📝 输出推理块**：将规划过程写入 `results/k01/.reasoning.md`（自动合并到全局日志）
6. **【第二次确认】技能计划确认**：使用 AskUserQuestion 确认技能生成计划
   - 展示：拟生成的 k_ 技能列表
   - 展示：每个技能的参考来源
7. 生成 k_ 技能：
   - 优先参考 p_ 技能内容生成
   - 其次参考 u_ 技能内容生成
   - 最后创建全新内容
   - **重要**：在每个 k_ 技能末尾添加"完成后续处理"章节，包含 AskUserQuestion
   - **📝 输出推理块**：将生成过程写入 `results/k01/.reasoning.md`（自动合并到全局日志）
8. 创建 `results/k01/` 目录和文件
9. 更新 `.info/tasks.json`

**数量控制**：
- k_ 技能少于 2 个：任务太简单，直接执行
- k_ 技能多于 3 个：任务太复杂，建议拆分或合并

### 经验模式 (u_ 前缀) - 经验提取

**原则**：总数保持在 **5 个以内**

1. 读取用户画像中的 `experience` 维度
2. 评估每个经验的复用价值
   - 是否是核心技能
   - 是否有通用性
   - 是否有独特的最佳实践
3. **用户确认**：展示拟生成的 u_ 技能列表，等待确认
4. 只保留高价值的经验，生成 `u_` 技能
5. 技能内容包含：执行流程、最佳实践、踩坑记录
6. 更新 `.info/tasks.json` 的 `user_skills` 字段

**数量控制**：
- 超过 5 个时：保留最近、最常用的 5 个
- 归档低频经验到 `results/archived/u_skills/`

## 子技能命名

详见 [命名规范](references/naming-conventions.md)：

### 任务模式 (k_ 前缀)

| 类型 | 模式 | 示例 |
|------|------|------|
| 初始化 | `k[任务]_init_[项目]` | k01_init_project |
| 配置 | `k[任务]_config_[功能]` | k01_config_mdx |
| 创建 | `k[任务]_create_[组件]` | k01_create_layout |
| 实现 | `k[任务]_implement_[功能]` | k01_implement_auth |
| 添加 | `k[任务]_add_[功能]` | k01_add_search |
| 删除 | `k[任务]_remove_[功能]` | k01_remove_deps |
| 更新 | `k[任务]_update_[内容]` | k01_update_deps |
| 修复 | `k[任务]_fix_[问题]` | k01_fix_routing |
| 测试 | `k[任务]_test_[模块]` | k01_test_api |
| 重构 | `k[任务]_refactor_[模块]` | k01_refactor_auth |

### 经验模式 (u_ 前缀)

| 类型 | 模式 | 说明 | 示例 |
|------|------|------|------|
| 技术栈经验 | `u_[tech]_[feature]` | 优先：核心技术+特性 | u_react_hooks, u_next_auth |
| 项目经验 | `u_[project]_[purpose]` | 备选：知名项目+用途 | u_blog_mdx, u_fastapi_crud |
| 工具经验 | `u_[tool]_[usage]` | 备选：工具+使用场景 | u_docker_deploy, u_git_workflow |

**命名优先级**：技术栈 > 项目 > 工具

## 输出结构

```
.claude/skills/
├── p_nextjs_mdx/SKILL.md          # 验证技能池（参考来源，≤10个）
├── p_docker_deploy/SKILL.md       # 验证技能池
├── p_research_open_source/SKILL.md # 验证技能池
├── u_react_hooks/SKILL.md         # 用户经验池（参考来源，≤5个）
├── u_docker_deploy/SKILL.md       # 用户经验池
├── u_fastapi_crud/SKILL.md        # 用户经验池
├── k01_init_project/SKILL.md      # 任务技能（实际执行，2-3个/任务）
├── k01_config_mdx/SKILL.md        # 任务技能
└── k02_design_schema/SKILL.md     # 任务技能

results/k01/
├── README.md        # 任务总览
├── plan.md          # 任务计划
├── execution.md     # 执行记录
├── notes.md         # 笔记
└── artifacts/       # 生成的文件
```

## 技能内容生成方法论

### k_ 技能生成步骤

#### 1. 任务分析

**输入**：任务描述（自然语言）
**输出**：任务类型、技术栈、复杂度评估

```
任务: "搭建 Next.js 博客"
  ↓
分析结果:
  - 类型: Web 开发
  - 技术栈: Next.js, MDX, TypeScript
  - 复杂度: 中等
  - 预计步骤: 3 个
```

#### 2. 技能匹配

**输入**：任务分析结果
**输出**：参考技能列表

```
p_ 技能池检查:
  - p_nextjs_mdx ✓ 匹配 (博客搭建)
  - p_docker_deploy ✗ 不相关
  - p_research_open_source ✗ 不相关

u_ 技能池检查:
  - u_react_hooks ✓ 匹配 (组件状态)
  - u_git_workflow ✗ 不直接相关
```

#### 3. 技能规划

**输入**：参考技能 + 任务需求
**输出**：2-3 个 k_ 技能方案

```
技能规划:
  1. k01_init_project (参考 p_nextjs_mdx)
     - 初始化 Next.js 项目
     - 配置 TypeScript 和 Tailwind

  2. k02_config_mdx (参考 p_nextjs_mdx)
     - 安装 MDX 依赖
     - 配置 MDX 解析器

  3. k03_create_layout (全新创建)
     - 创建页面布局
     - 实现文章列表和详情页
```

#### 4. 内容生成

**输入**：技能规划 + 用户画像
**输出**：完整的 SKILL.md 文件

```
基于用户画像定制:
  - tech_stack.primary_languages → 使用 TypeScript 示例
  - preferences.code_style → 遵循既定命名规范
  - goals.pain_points → 避开已知的 MDX 配置陷阱
```

### 内容生成原则

| 原则 | 说明 |
|:-----|------|
| **具体化** | 步骤描述具体可执行，避免模糊表述 |
| **可验证** | 每个步骤有明确的完成标准 |
| **完整性** | 包含从开始到结束的完整流程 |
| **用户导向** | 根据用户画像定制内容和风格 |
| **参考溯源** | 标注参考的 p_/u_ 技能来源 |
| **自动继续** | k_ 技能末尾必须包含"完成后续处理"章节，询问是否执行下一步 |

### 质量检查

生成技能后，检查：

```
□ YAML 前置元数据完整
□ 角色定位清晰
□ 执行流程完整
□ 包含预期输出
□ 有错误处理说明
□ 标注参考来源
□ 符合命名规范
□ 格式正确
□ k_ 技能包含"完成后续处理"章节
□ k_ 技能 YAML 包含 task_id, step_index, total_steps, next_skill
□ k_ 技能使用 AskUserQuestion 询问是否继续
```

详见 [技能结构清单](references/skill-structure.md)。

### 技能生成参考策略

```
新任务分析
    ↓
收集能力需求
    ↓
检查 p_ 技能池（最多10个）
    ↓
找到匹配 → 参考内容生成 k_（记录来源）
    ↓
未找到 → 检查 u_ 技能池（最多5个）
    ↓
找到匹配 → 参考内容生成 k_（记录来源）
    ↓
未找到 → 创建全新内容生成 k_
    ↓
汇总：生成 2-3 个 k_ 技能
```

> **注意**：步骤列表只包含 k_ 技能（2-3个），p_ 和 u_ 是生成 k_ 时的参考来源

### 技能参考机制

当生成任务技能时，**检查**是否有可参考的 p_ 技能或 u_ 技能：

#### 1. 参考逻辑

```
1. 分析任务关键词（技术栈、工具、领域）
2. 在 p_ 技能池中搜索匹配项
3. 在 u_ 技能池中搜索匹配项
4. 确定需要创建的能力空白
```

#### 2. 匹配示例

| 任务描述关键词 | 可能匹配的参考技能 |
|---------------|-------------------|
| 调研、研究、开源项目 | `p_research_open_source` |
| 文章、撰写、技术博客 | `p_article_techwriter` |
| 部署、Docker、容器化 | `p_docker_deploy` |
| Next.js、MDX、博客 | `p_nextjs_mdx` |
| React 组件、状态管理 | `u_react_hooks` |

#### 3. 参考后的处理

技能生成后会：
- 在 k_ 技能文档中标注参考来源
- hook 系统自动更新相关技能的 usage_count
- 记录技能关联到 tasks.json

#### 4. 分析结果展示

```
┌─────────────────────────────────────────┐
│ 技能分析完成                             │
├─────────────────────────────────────────┤
│ ✅ k01_init_project                     │
│    参考: p_nextjs_mdx (已验证，复用3次) │
│                                         │
│ ✅ k02_config_auth                      │
│    参考: u_react_hooks (用户经验)       │
│                                         │
│ ✅ k03_ssg_deployment                    │
│    全新内容创建                          │
└─────────────────────────────────────────┘
```

### 技能生成决策树

```
                    任务分析
                       │
                收集能力需求（2-3个）
                       │
         ┌─────────────┼─────────────┐
         │             │             │
    检查 p_ 技能   检查 u_ 技能   确定空白
    (技能池≤10)   (技能池≤5)
         │             │             │
    ┌────┴────┐   ┌────┴────┐      │
    │         │   │         │      │
 找到参考   未找到 找到参考  未找到  ↓
    │         │   │         │    创建新内容
    ↓         │   ↓         │    ↓
    └─────────┴───┴─────────┴──────┘
                       │
              【第一次确认】分析结果
                       │
              用户确认分析正确？
              ├─ 否 → 调整分析 → 重新确认
              └─ 是 → 继续
                       │
               规划 k_ 技能方案（2-3个）
                       │
              【第二次确认】技能计划
                       │
              用户确认技能方案？
              ├─ 否 → 调整规划 → 重新确认
              └─ 是 → 继续
                       │
                生成 k_ 技能文件
```

**关键点**：
- 步骤列表只包含 k_ 技能
- p_ 和 u_ 是生成 k_ 时的参考来源
- 数量限制：k_ 技能 2-3 个/任务
- **新增**：两次确认流程（分析结果确认 + 技能计划确认）

## 推理块格式规范

在执行关键步骤时，使用以下格式输出推理过程，以便用户了解"用了什么方法"和"得到了什么结论"：

```markdown
### 步骤名称

<reasoning>
🎯 目标：[当前步骤要达成什么]
🔍 方法：[使用了什么方法/工具/策略]
💡 发现：[观察到了什么/得到了什么数据]
✅ 决策：[做出了什么决策及理由]
</reasoning>

**执行**：[具体操作步骤]
```

**推理块会被自动捕获**：
- 推理块会通过 Hook 系统自动捕获
- 写入 `results/k01/.reasoning.md`（任务级）
- 同时合并到 `.info/.reasoning.md`（全局，活跃任务）

**示例**：
```markdown
### 1. 分析任务能力需求

<reasoning>
🎯 目标：识别"搭建 Next.js 博客"任务所需的核心能力
🔍 方法：提取关键词 → 匹配技能池 → 识别空白
💡 发现：
  - 技术栈：Next.js, MDX, TypeScript
  - 匹配到 p_nextjs_mdx（验证技能，已复用 3 次）
  - 能力空白：页面布局、SSG 部署
✅ 决策：生成 3 个 k_ 技能，参考 p_nextjs_mdx
</reasoning>

**执行**：
- 读取 `.info/usr.json`
- 搜索 `p_*/SKILL.md`
- 确定技能生成方案
```

---

## k_ 前缀技能的内容结构

```markdown
---
name: k01_init_project
description: k01 任务：初始化 Next.js 项目。这是任务"搭建 Next.js 博客"的第 1/3 步骤。包含：创建项目、配置 TypeScript、安装 Tailwind CSS。
task_id: k01
step_index: 0
total_steps: 3
next_skill: k01_config_mdx
---

# k01_init_project

任务 k01 的第 1 步：初始化 Next.js 项目。

## 阶段目标

创建 Next.js 项目基础结构，完成开发环境配置。

## 执行流程

### 1. 创建项目
```bash
npx create-next-app@latest blog --typescript --tailwind --app
```

### 2. 验证安装
```bash
cd blog && npm run dev
```

## 预期输出

- 项目目录：`blog/`
- 开发服务器运行在：http://localhost:3000
- TypeScript 配置：`tsconfig.json`
- Tailwind 配置：`tailwind.config.ts`

## 完成标准

- [ ] 项目创建成功
- [ ] 开发服务器可正常启动
- [ ] 首页显示正常

## 完成后续处理

✅ **阶段完成！**

当前进度：1/3
- ✓ k01_init_project (本步骤)
- ⏭ k01_config_mdx (下一步)
- ⏳ k01_create_layout (待执行)

**使用 AskUserQuestion 询问用户：**

```
阶段 1/3 已完成：初始化 Next.js 项目

下一步是：k02_config_mdx (配置 MDX)
- 安装 @next/mdx 和相关依赖
- 配置 MDX 解析器和组件
- 设置 frontmatter 支持

请选择：
- 继续执行下一步 (k02_config_mdx)
- 查看任务详情 (/commander progress k01)
- 暂停，稍后手动继续 (/commander continue k01)
```

**实现方式：**
使用 `AskUserQuestion` 工具，参数：
```json
{
  "questions": [{
    "question": "阶段 1/3 已完成。是否继续执行下一步：k02_config_mdx (配置 MDX)？",
    "header": "继续任务",
    "options": [
      {"label": "继续下一步", "description": "执行 k02_config_mdx：配置 MDX 解析器和组件"},
      {"label": "查看进度", "description": "显示任务详细进度和执行记录"},
      {"label": "暂停", "description": "稍后使用 /commander continue k01 继续执行"}
    ],
    "multiSelect": false
  }]
}
```

## 参考来源
- p_nextjs_mdx (验证技能)
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
      "steps": ["k01_mdx_integration", "k01_dynamic_routing"],
      "current_step": 0,
      "created_at": "2026-01-27T16:00:00Z"
    }
  },
  "user_skills": {
    "u_next_mdx": {
      "name": "Next.js + MDX 博客",
      "level": "proficient",
      "created_at": "2026-01-28T10:00:00Z",
      "related_tasks": ["k01"],
      "usage_count": 3
    }
  },
  "proven_skills": {},
  "archived_u_skills": ["u_old_react_classic"]
}
```

**字段说明**：
- `tasks.k01.steps`: 任务步骤列表（只包含 k_ 技能，2-3 个）
- `tasks.k01.current_step`: 当前进度索引
- `user_skills`: 用户经验技能池（供生成 k_ 时参考），最多 5 个
- `proven_skills`: 验证技能池（供生成 k_ 时参考），最多 10 个
- `archived_u_skills`: 已归档的低频 u_ 技能列表
- `usage_count`: 技能被参考/复用次数，用于归档决策

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
| k_ 技能少于 2 个 | 任务过于简单，可直接执行 |
| k_ 技能多于 3 个 | 任务过于复杂，建议拆分或合并技能 |
| u_ 技能超过 5 个 | 归档低频经验，保留最常用的 5 个 |
| p_ 技能超过 10 个 | 归档低频技能，保留最常用的 10 个 |
| 用户取消生成 | 恢复 tasks.json 的 next_id |

## 用户确认流程

### 第一次确认：分析结果确认

在分析完任务后、规划技能前，使用 AskUserQuestion 确认分析结果：

```
任务"搭建 Next.js 博客"的分析完成：

┌─────────────────────────────────────────┐
│ 📊 分析结果                              │
├─────────────────────────────────────────┤
│ 任务类型: Web 开发                       │
│ 技术栈: Next.js, MDX, TypeScript        │
│ 复杂度: 中等                            │
│ 预计步骤: 3 个                          │
├─────────────────────────────────────────┤
│ 🎯 匹配的参考技能                       │
│ ✅ p_nextjs_mdx (验证技能，复用3次)     │
│ ✅ u_react_hooks (用户经验)             │
├─────────────────────────────────────────┤
│ 📋 能力空白                             │
│ • 页面布局创建                          │
│ • SSG 部署配置                          │
└─────────────────────────────────────────┘

分析结果是否正确？
- 确认，继续规划技能
- 调整：修改分析结果
- 取消，重新分析
```

**实现方式：**
```json
{
  "questions": [{
    "question": "任务分析完成。类型：Web 开发，技术栈：Next.js + MDX，复杂度：中等。匹配到参考技能：p_nextjs_mdx, u_react_hooks。是否确认继续？",
    "header": "确认分析",
    "options": [
      {"label": "确认继续", "description": "分析结果正确，继续规划技能方案"},
      {"label": "调整分析", "description": "修改技术栈或复杂度评估"},
      {"label": "取消", "description": "取消当前任务"}
    ],
    "multiSelect": false
  }]
}
```

### 第二次确认：技能计划确认

技能规划完成后，使用 AskUserQuestion 确认技能生成计划：

```
任务"搭建 Next.js 博客"的技能规划完成：

将生成 3 个 k_ 技能：
┌─────────────────────────────────────────┐
│ ✅ k01_init_project                      │
│    参考: p_nextjs_mdx (已验证，复用3次) │
│                                         │
│ ✅ k02_config_auth                       │
│    参考: u_react_hooks (用户经验)       │
│                                         │
│ ✅ k03_ssg_deployment                    │
│    全新内容创建                          │
└─────────────────────────────────────────┘

是否接受此方案？
- 接受，开始生成技能
- 调整：修改技能列表
- 取消，重新规划
```

### 步骤列表确认（已废弃，由上述两次确认替代）

技能分析完成后，使用 AskUserQuestion 展示方案：

```
任务"搭建 Next.js 博客"的技能分析完成：

将生成 3 个 k_ 技能：
┌─────────────────────────────────────────┐
│ ✅ k01_init_project                      │
│    参考: p_nextjs_mdx (验证技能)         │
│                                         │
│ ✅ k02_config_auth                       │
│    参考: u_react_hooks (用户经验)        │
│                                         │
│ ✅ k03_ssg_deployment                    │
│    全新内容创建                          │
└─────────────────────────────────────────┘

是否接受此方案？
- 接受，开始生成技能
- 调整：修改技能列表
- 取消，重新分析
```

### 任务复杂度异常确认

当识别到需要超过 3 个 k_ 技能时：

```
任务分析完成，但识别到需要 5 个 k_ 技能。

超过 3 个上限，请选择处理方式：

- 拆分任务：将大任务拆分为 2-3 个子任务
- 合并技能：将相关技能合并为 2-3 个综合技能
- 继续生成：按 5 个技能生成（不推荐）
```
