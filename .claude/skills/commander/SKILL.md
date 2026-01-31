---
name: commander
description: 任务管理主入口。用于：(1) 使用 /commander start 启动新任务，(2) 使用 /commander status 查看全局状态，(3) 查看任务进度，(4) 继续执行任务，(5) 管理任务生命周期。启动任务前会自动检查用户画像新鲜度。
---

# Commander

任务管理系统的主入口，协调整个工作流程。

## 角色定位

**commander 是任务调度器**，管理任务的完整生命周期。

### 职责边界

| ✅ 应该做 | ❌ 不应该做 |
|---------|-----------|
| 管理任务状态（active/completed/archived） | 分析任务内容 |
| 调用 skill-generator 生成技能 | 直接生成技能文件 |
| 协调生成的技能执行 | 提取用户画像信息 |
| 创建任务结果目录（results/k01/） | 修改 .info/usr.json |
| 检查用户画像新鲜度 | 决定生成哪些技能 |
| 维护 tasks.json 的任务数据 | 决定技能的执行顺序 |
| 任务完成时询问是否升级 k_ 技能为 p_ 技能 | 直接修改技能文件 |

### 与其他 Skills 的关系

```
                ┌─────────────────┐
                │   commander     │ (任务调度器)
                └────────┬────────┘
                         │
        ┌────────────────┼────────────────┐
        ↓                ↓                ↓
┌───────────────┐  ┌──────────────┐  ┌─────────────┐
│ user-profile  │  │skill-generator│  │ k01_* skills │
│ (检查画像)    │  │ (生成技能)    │  │ (执行任务)   │
└───────────────┘  └──────────────┘  └─────────────┘
```

- **对 user-profile**：检查画像新鲜度，提示用户更新（不直接调用）
- **对 skill-generator**：调用生成技能，接收技能列表
- **对 k_ 技能**：协调执行顺序，跟踪进度
- **数据流**：任务描述 → skill-generator → 技能列表 → commander → 执行协调

## 命令

| 命令 | 功能 |
|-----|------|
| `/commander start [描述]` | 启动新任务 |
| `/commander status` | 显示全局状态 |
| `/commander progress k01` | 显示任务详细进度 |
| `/commander list` | 列出所有任务 |
| `/commander results k01` | 显示任务结果文件 |
| `/commander continue k01` | 继续执行下一步 |
| `/commander complete k01` | 标记任务完成 |
| `/commander archive k01` | 归档已完成任务 |

详见 [命令详细说明](references/commands.md)

## 用户画像检查

启动任务前自动检查 `info/` 目录是否有新文件，提示更新画像。

详见 [画像检查流程](references/profile-check.md)

## 目录管理

每个任务在 `results/k01/` 下创建独立目录：

```
results/k01/
├── README.md       # 任务总览
├── plan.md         # 任务计划
├── execution.md    # 执行记录
├── notes.md        # 笔记
├── .reasoning.md   # 推理日志（实时维护）
└── artifacts/      # 生成的文件
```

详见 [目录管理](references/directory-management.md)

## 推理日志

commander 在执行任务时会输出推理块，记录"用了什么方法"和"得到了什么结论"：

```markdown
<reasoning>
🎯 目标：[当前步骤的目标]
🔍 方法：[使用了什么方法/工具]
💡 发现：[得到了什么发现/结论]
✅ 决策：[做出了什么决策及原因]
</reasoning>
```

推理块会通过 Hook 系统自动捕获：
- 写入 `results/k01/.reasoning.md`（任务级）
- 同时合并到 `.info/.reasoning.md`（全局，活跃任务）

**查看推理日志**：
- `cat .info/.reasoning.md` - 查看全局活跃任务推理
- `cat results/k01/.reasoning.md` - 查看特定任务推理

## 任务状态

| 状态 | 说明 |
|-----|------|
| `active` | 进行中 |
| `completed` | 已完成 |
| `archived` | 已归档 |

详见 [状态管理](references/task-states.md)

## 错误处理

| 场景 | 处理方式 |
|-----|---------|
| 画像缺失 | 提示运行 `/user-profile` |
| 画像过期 | 提示更新，显示新文件 |
| tasks.json 损坏 | 重建默认结构 |
| 任务 ID 冲突 | 自动递增 next_id |

详见 [错误处理](references/error-handling.md)

## 技能升级流程

当任务完成时，询问是否将成功的 k_ 技能升级为 p_ 技能（验证技能）：

```
/commander complete k01
    ↓
任务标记为 completed
    ↓
分析任务中的 k_ 技能
    ↓
AskUserQuestion: 是否将成功的技能升级为可复用技能？
    ↓
是 → 调用 promote-to-proven.sh
    ↓
k01_research → p_research_open_source
```

### 技能分类

| 类型 | 前缀 | 来源 | 生命周期 | 上限 |
|-----|-----|------|---------|-----|
| 任务技能 | `k_` | 任务创建时生成 | 临时，任务完成后可选升级 | 2-3个/任务 |
| 验证技能 | `p_` | k_ 技能升级 | 永久，可被后续任务复用 | 10个 |
| 用户技能 | `u_` | info/ 更新 | 永久，用户主动维护 | 5个 |

### 升级询问示例

```
任务 k01 已完成！

执行过程中使用了以下技能：
┌─────────────────────────────────────────┐
│ ✓ k01_research_openclaw    (成功)       │
│ ✓ k01_write_article         (成功)       │
└─────────────────────────────────────────┘

是否将成功的技能升级为可复用的验证技能？

选择要升级的技能：
- p_research_open_source  (从 k01_research)
- p_article_techar         (从 k01_write_article)
- 全部升级
- 跳过
```
