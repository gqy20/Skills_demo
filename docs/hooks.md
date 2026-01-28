# Hooks 说明

本项目使用 Claude Code 的 Hooks 系统实现自动化工作流，包括用户画像检查、技能变更追踪、状态更新等功能。

## 目录

```
.claude/hooks/
├── session-start.sh         # 会话启动时的检查
├── track-skills-change.sh   # 技能文件变更追踪
├── update-status.sh         # 系统状态更新
└── count-skills-usage.sh    # 技能使用统计
```

## 配置文件

Hooks 在 `.claude/settings.json` 中配置：

```json
{
  "hooks": {
    "SessionStart": [...],
    "PostToolUse": [...]
  }
}
```

## Hook 详解

### 1. session-start.sh

**触发时机**: 每次 Claude Code 会话启动时

**功能**:
- 检查用户画像是否存在 (`.info/usr.json`)
- 检查 `info/` 目录是否有新文件
- 比较文件修改时间，判断画像是否需要更新
- 显示用户信息和当前掌握的技能数量

**输出示例**:
```
✅ 用户画像已加载: QY (全栈开发者)
   当前掌握 3 个用户技能
```

**依赖**: `jq` (JSON 处理工具)

---

### 2. track-skills-change.sh

**触发时机**: 使用 `Write` 或 `Edit` 工具修改 `.claude/skills/` 目录中的文件时

**功能**:
- 追踪技能文件的创建和修改
- 自动将新技能注册到 `tasks.json`
- 记录技能变更到 `.info/skills_changelog.jsonl`

**技能类型识别**:
| 模式 | 类型 | 示例 |
|------|------|------|
| `^u_[a-z_]+$` | user | `u_react_hooks` |
| `^k[0-9]+_[a-z_]+$` | task | `k01_init_project` |
| 其他 | builtin | `user-profile` |

**自动化行为**:
- 创建 `u_` 技能 → 自动添加到 `tasks.json.user_skills`
- 创建 `k_` 技能 → 自动关联到对应任务并添加到 `steps` 列表

---

### 3. update-status.sh

**触发时机**:
- SessionStart
- Write/Edit 工具使用后
- TaskCreate/TaskUpdate 工具使用后

**功能**:
- 聚合系统状态信息
- 写入 `.info/.status.json` 供 statusline 使用

**状态文件结构**:
```json
{
  "active_task": "k01",
  "task_name": "搭建 Next.js 博客",
  "total_steps": 5,
  "completed_steps": 2,
  "total_tasks": 3,
  "active_tasks": 1,
  "completed_tasks": 1,
  "user_name": "QY",
  "user_role": "全栈开发者",
  "skills_count": 3,
  "profile_fresh": true,
  "updated_at": "2026-01-28T10:30:00Z"
}
```

---

### 4. count-skills-usage.sh

**触发时机**: 被 statusline.sh 调用（按需执行）

**功能**:
- 统计项目技能的总使用次数
- 从 `~/.claude/projects/` 会话历史中提取技能调用
- 从 `~/.claude/history.jsonl` 全局历史中统计
- 使用缓存减少重复计算（5分钟 TTL）

**输出**: 整数值（总使用次数）

---

## Hook 执行流程

```
┌─────────────────────────────────────────────────────────────┐
│                    Claude Code 会话启动                       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │ session-start   │
                    │  - 检查画像     │
                    │  - 显示用户信息 │
                    └─────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │ update-status   │
                    │  - 更新状态文件 │
                    └─────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    工具使用 (Write/Edit)                     │
└─────────────────────────────────────────────────────────────┘
                              │
                ┌─────────────┴─────────────┐
                ▼                           ▼
        ┌───────────────┐         ┌───────────────┐
        │ track-skills  │         │ update-status │
        │  - 注册技能   │         │  - 更新状态   │
        │  - 记录变更   │         └───────────────┘
        └───────────────┘
```

## 依赖要求

所有 hooks 依赖以下工具：

| 工具 | 用途 | 安装命令 |
|------|------|----------|
| `jq` | JSON 处理 | `brew install jq` / `apt install jq` |
| `bash` | Shell 执行 | 系统自带 |

## 故障排除

### Hook 未执行

1. 检查 `.claude/settings.json` 中 hooks 配置是否正确
2. 确认脚本文件具有执行权限 (`chmod +x .claude/hooks/*.sh`)
3. 查看 Claude Code 日志确认 hook 调用情况

### 状态未更新

1. 确认 `jq` 已安装
2. 检查 `.info/.status.json` 文件权限
3. 手动运行 hook 测试: `bash .claude/hooks/update-status.sh`

### 技能未自动注册

1. 确认技能目录命名符合规范 (`k01_xxx` 或 `u_xxx`)
2. 检查 `.info/tasks.json` 文件格式是否正确
3. 查看 `.info/skills_changelog.jsonl` 获取详细日志
