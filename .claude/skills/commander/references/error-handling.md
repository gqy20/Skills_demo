# 错误处理

## 常见错误场景

### 用户画像缺失

**检测条件**：`.info/usr.json` 不存在

**处理方式**：
```
✗ 错误：用户画像不存在

请先运行 /user-profile 生成用户画像。

> /user-profile
```

### 用户画像过期

**检测条件**：`info/` 目录中有文件修改时间晚于 `usr.json.metadata.last_checked_at`

**处理方式**：
```
⚠ 警告：用户画像可能过期

检测到以下文件有更新：
  - info/bio.md (2026-01-27 15:20)
  - info/skills.md (2026-01-27 15:25)

建议运行 /user-profile 更新画像。

是否现在更新？[y/n]
```

### tasks.json 损坏

**检测条件**：JSON 解析失败或缺少必要字段

**处理方式**：
```python
try:
    with open(".info/tasks.json", "r") as f:
        tasks = json.load(f)
except (json.JSONDecodeError, KeyError):
    # 备份损坏的文件
    shutil.copy(".info/tasks.json", ".info/tasks.json.backup")
    # 重建默认结构
    tasks = {"next_id": 1, "tasks": {}}
    with open(".info/tasks.json", "w") as f:
        json.dump(tasks, f, indent=2)
    prompt("tasks.json 已损坏，已重建默认结构")
```

### 任务 ID 冲突

**检测条件**：`tasks.json` 中已存在相同 ID

**处理方式**：
```python
while task_id in tasks["tasks"]:
    next_id += 1
    task_id = f"k{next_id:02d}"
tasks["next_id"] = next_id + 1
```

### 子技能创建失败

**检测条件**：skill-generator 返回空列表或出错

**处理方式**：
```
✗ 错误：无法生成任务计划

请尝试：
  1. 检查任务描述是否清晰
  2. 运行 /user-profile 更新画像
  3. 简化任务描述

是否重试？[y/n]
```

### 目录创建失败

**检测条件**：`results/k01/` 已存在或无权限

**处理方式**：
```python
if os.path.exists(f"results/{task_id}"):
    prompt(f"警告：results/{task_id} 已存在")
    prompt("是否覆盖？[y/n]")
    if not confirm:
        return
    shutil.rmtree(f"results/{task_id}")

try:
    os.makedirs(f"results/{task_id}/artifacts")
except PermissionError:
    prompt("✗ 错误：无目录创建权限")
    return
```

## 错误日志

所有错误应记录到 `results/.error.log`：

```markdown
## 2026-01-27 16:30:00

### 任务创建失败

任务 ID: k01
错误: tasks.json 损坏
解决: 重建默认结构
```

## 用户友好的错误提示

| 错误类型 | 提示风格 |
|---------|---------|
| 缺失文件 | ✗ 错误：文件不存在 |
| 过期数据 | ⚠ 警告：数据可能过期 |
| 操作失败 | ✗ 操作失败：[原因] |
| 需要确认 | ⚠ 需要用户确认 |

## 恢复策略

| 场景 | 恢复方式 |
|-----|---------|
| tasks.json 损坏 | 从备份恢复或重建 |
| 子技能执行中断 | 重新执行当前步骤 |
| 用户画像缺失 | 提示运行 /user-profile |
| 目录权限问题 | 提示检查权限 |
