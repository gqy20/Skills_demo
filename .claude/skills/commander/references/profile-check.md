# 用户画像新鲜度检查

## 检查时机

每次执行 `/k start` 命令前，自动执行以下检查。

## 检查流程

### 1. 检查画像文件是否存在

```python
if not exists(".info/usr.json"):
    prompt "请先运行 /user-profile 生成用户画像"
    return
```

### 2. 读取画像时间戳

```python
import json

with open(".info/usr.json", "r") as f:
    usr = json.load(f)

profile_time = usr["metadata"]["last_checked_at"]
```

### 3. 扫描 info/ 目录

```python
import glob
import os

info_files = glob.glob("info/*")
info_timestamps = {
    f: os.path.getmtime(f)
    for f in info_files
    if os.path.isfile(f)
}
```

### 4. 比较时间戳

```python
newer_files = [
    path for path, mtime in info_timestamps.items()
    if mtime > profile_time
]

if newer_files:
    prompt(f"检测到 {len(newer_files)} 个新文件:")
    for f in newer_files:
        prompt(f"  - {f}")
    prompt("建议运行 /user-profile 更新画像")
    prompt("是否现在更新？[y/n]")
```

## 时间戳字段说明

| 字段 | 类型 | 说明 |
|-----|------|------|
| `metadata.generated_at` | ISO 8601 | 画像首次生成时间 |
| `metadata.last_checked_at` | ISO 8601 | 最后一次检查 info/ 目录的时间 |
| `metadata.source_mtimes` | Object | 各源文件的修改时间戳 |

## 处理策略

| 场景 | 处理方式 |
|-----|---------|
| 画像不存在 | 阻止启动，提示创建 |
| 有新文件 | 建议更新，可选继续 |
| 无新文件 | 正常启动任务 |

## 交互提示示例

```
═══════════════════════════════════════════════════════
用户画像检查
═══════════════════════════════════════════════════════

检测到 info/ 目录有新文件:

  info/new-project.md    (修改于 2026-01-27 15:20)
  info/skills-update.md  (修改于 2026-01-27 15:25)

建议运行 /user-profile 更新画像以确保信息准确。

是否现在更新？[y/n]

> y

正在更新用户画像...
✓ 画像已更新

继续启动任务？[y/n]
```

## 画像更新后的恢复

用户更新画像后，应自动恢复任务启动流程，无需用户重新输入任务描述。

实现方式：在上下文中保存待启动的任务描述。
