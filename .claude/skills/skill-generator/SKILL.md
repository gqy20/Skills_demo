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
| 读取 .info/usr.json 获取用户画像 | 修改 tasks.json 的任务数据 |
| 生成技能文件（SKILL.md） | 创建任务结果目录 |
| 决定生成哪些技能及数量 | 协调技能执行顺序 |
| 从画像中提取经验生成 u_ 技能 | 检查用户画像新鲜度 |
| 返回技能列表给调用者 | 执行生成的技能 |

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

```python
Skill("skill-generator", "k01 搭建 Next.js 博客")
```

### 经验模式（由 user-profile 调用）

```python
Skill("skill-generator", "--mode=experience")
```

或用户手动调用：

```python
/skill-generator experience
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
   - 识别关键技术点（框架、语言、工具）
   - 检查可参考的 p_ 技能（验证技能）
   - 检查可参考的 u_ 技能（用户经验）
   - 确定需要创建的能力空白
4. **用户确认**：展示技能分析结果，等待用户确认
5. 生成 k_ 技能：
   - 优先参考 p_ 技能内容生成
   - 其次参考 u_ 技能内容生成
   - 最后创建全新内容
6. 创建 `results/k01/` 目录和文件
7. 更新 `.info/tasks.json`

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

### p_ 技能复用实现（重要）

当生成任务技能时，**必须检查**是否有可复用的 p_ 技能：

#### 1. 检查逻辑

```bash
# 加载共享库
source ".claude/hooks/lib/common.sh"

# 查找可复用的 p_ 技能
P_SKILL=$(find_reusable_p_skill "$任务描述")

if [ -n "$P_SKILL" ]; then
    # 复用现有 p_ 技能
    TASK_ID="k02"

    # 记录复用事件并增加 usage_count
    log_skill_event "skill_reused" "$P_SKILL" \
        '"task": "'"$TASK_ID"'"' \
        '"context": "'"$任务描述"'"'

    echo "♻️  复用验证技能: $P_SKILL"

    # 获取当前复用次数
    REUSE_COUNT=$(json_read "$TASKS_FILE" ".proven_skills[\"$P_SKILL\"].usage_count // 0")
    echo "   该技能已被复用 $REUSE_COUNT 次"

    # 任务使用复用的技能，不创建新的 k_ 技能
    TASKS="$P_SKILL"
else
    # 生成新的 k_ 技能
    echo "生成新的 k_ 技能..."
fi
```

#### 2. 匹配规则（示例）

| 任务描述关键词 | 可能匹配的 p_ 技能 |
|---------------|------------------|
| 调研、研究、开源项目 | `p_research_open_source` |
| 文章、撰写、技术博客 | `p_article_techwriter` |
| 部署、Docker、容器化 | `p_docker_deploy` |
| Next.js、MDX、博客 | `p_nextjs_mdx` |

> **注意**：以上为示例，实际匹配需根据 p_ 技能库动态判断

#### 3. 复用后操作

```bash
# 更新 tasks.json
# 1. 增加 usage_count
# 2. 添加到 related_tasks
# 3. 更新 last_used_at
# 4. 记录事件到 .skills_events.jsonl
```

#### 4. 显示格式

任务分析完成后，向用户展示：

```
┌─────────────────────────────────────────┐
│ 技能分析完成                             │
├─────────────────────────────────────────┤
│ ✅ p_research_open_source (复用)         │
│    该技能已被验证，已在 3 个任务中使用   │
│    复用后 usage_count: 4                 │
│                                         │
│ ❌ k02_write_report (新增)               │
│    无可复用技能，需要创建                │
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
参考生成    │  参考生成   │    └─────────┐
    │         │   │         │              │
    └─────────┴───┴─────────┴──────────────┘
                       │
                生成 k_ 技能（2-3个）
                       │
                  用户确认
```

**关键点**：
- 步骤列表只包含 k_ 技能
- p_ 和 u_ 是生成 k_ 时的参考来源
- 数量限制：k_ 技能 2-3 个/任务

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

### 步骤列表确认

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
