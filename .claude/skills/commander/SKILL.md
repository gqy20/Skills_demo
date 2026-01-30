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
└── artifacts/      # 生成的文件
```

详见 [目录管理](references/directory-management.md)

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
