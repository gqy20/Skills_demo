---
name: commander
description: Main entry point for task management. Use this to: (1) Start new tasks with /k start, (2) Check global status with /k status, (3) View task progress, (4) Continue execution, (5) Manage task lifecycle. Automatically checks profile freshness before starting tasks.
---

# Commander

Main entry point for task management. Coordinates the entire system workflow.

## Commands

### `/k start [task description]`

Start a new task.

**Pre-check**: Verifies user profile freshness before proceeding.

**Process**:
1. Check `.info/usr.json` exists
2. Scan `info/` directory for new/modified files
3. If profile outdated → prompt to run `/user-profile`
4. Assign task ID (k01, k02, ...)
5. Call skill-generator to break down task
6. Show plan and wait for confirmation
7. Generate sub-skills
8. Create `results/k01/` directory
9. Update `.info/tasks.json`

### `/k status`

Display global status overview.

```
═══════════════════════════════════════════════════════
全局状态
═══════════════════════════════════════════════════════

用户画像: ✓ 已生成 (更新时间: 2026-01-27 14:30)

任务统计:
  总任务数: 3
  进行中:   2
  已完成:   1

任务列表:
  k01  搭建 Next.js 博客      [████░░] 3/5  进行中
  k02  文章搜索功能           [██░░░░] 1/4  进行中
  k03  用户认证系统           [█████] 5/5  已完成

═══════════════════════════════════════════════════════
```

### `/k progress k01`

Show detailed progress for a specific task.

### `/k list`

List all tasks with brief status.

### `/k results k01`

Show task results and files in `results/k01/`.

### `/k continue k01`

Continue to next step of the task.

### `/k complete k01`

Mark task as completed.

### `/k archive k01`

Archive completed task to `results/archived/`.

## Profile Freshness Check

Before starting any task, Commander performs:

```python
# 1. Check profile exists
if not exists(".info/usr.json"):
    prompt "请先运行 /user-profile 生成用户画像"

# 2. Get profile timestamp
profile_time = usr.json.metadata.generated_at

# 3. Scan info/ directory
info_files = glob("info/*")
info_timestamps = [get_mtime(f) for f in info_files]

# 4. Compare timestamps
if any(f > profile_time for f in info_timestamps):
    prompt f"检测到 info/ 目录有新文件，建议运行 /user-profile 更新画像"
    prompt "是否现在更新？[y/n]"
```

## Directory Management

### results/ Structure

```
results/
├── k01/
│   ├── README.md        # Task overview
│   ├── plan.md          # Task plan
│   ├── execution.md     # Execution log
│   ├── notes.md         # Notes
│   └── artifacts/       # Generated files
└── archived/            # Archived tasks
```

## Task States

| State | Description |
|-------|-------------|
| `active` | Currently in progress |
| `completed` | All steps finished |
| `archived` | Moved to archived/ |

## Error Handling

| Scenario | Action |
|----------|--------|
| Profile missing | Prompt `/user-profile` |
| Profile outdated | Prompt to update, show new files |
| tasks.json corrupt | Rebuild with default structure |
| Task ID conflict | Auto-increment next_id |
