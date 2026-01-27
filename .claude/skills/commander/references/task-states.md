# 任务状态管理

## 状态定义

| 状态 | 说明 | 可转换到的状态 |
|-----|------|--------------|
| `active` | 任务进行中 | completed, archived |
| `completed` | 所有步骤已完成 | archived |
| `archived` | 已归档 | - |

## 状态转换图

```
     ┌─────────┐
     │  创建   │
     └────┬────┘
          │
          ▼
    ┌──────────┐
    │  active  │◄─────────────┐
    └─────┬────┘              │
          │                   │
          │ 所有步骤完成        │
          ▼                   │
    ┌───────────┐             │
    │completed  │─────────────┘
    └─────┬─────┘
          │
          │ 归档
          ▼
    ┌───────────┐
    │ archived  │
    └───────────┘
```

## 状态字段

### tasks.json 结构

```json
{
  "next_id": 4,
  "tasks": {
    "k01": {
      "id": "k01",
      "name": "搭建 Next.js 博客",
      "type": "web",
      "status": "active",
      "steps": [
        "k01_init_project",
        "k01_config_mdx",
        "k01_create_layout",
        "k01_article_list",
        "k01_deploy"
      ],
      "current_step": 2,
      "created_at": "2026-01-27T16:00:00Z",
      "completed_at": null,
      "archived_at": null
    }
  }
}
```

### 字段说明

| 字段 | 类型 | 说明 |
|-----|------|------|
| `id` | string | 任务 ID (k01, k02...) |
| `name` | string | 任务名称 |
| `type` | string | 任务类型 |
| `status` | string | 当前状态 |
| `steps` | array | 所有子技能名称 |
| `current_step` | number | 当前执行到的步骤索引 |
| `created_at` | string | 创建时间 |
| `completed_at` | string\|null | 完成时间 |
| `archived_at` | string\|null | 归档时间 |

## 状态变更操作

### 创建任务

```json
{
  "status": "active",
  "current_step": 0,
  "created_at": "2026-01-27T16:00:00Z",
  "completed_at": null,
  "archived_at": null
}
```

### 完成步骤

```json
{
  "current_step": current_step + 1
}
```

### 完成任务

```json
{
  "status": "completed",
  "current_step": steps.length,
  "completed_at": "2026-01-27T18:00:00Z"
}
```

### 归档任务

```json
{
  "status": "archived",
  "archived_at": "2026-01-27T18:30:00Z"
}
```

## 进度计算

```
进度 = (current_step / total_steps) × 100%

示例:
  current_step = 3
  total_steps = 5
  进度 = 3/5 × 100% = 60%
```

## 进度显示

```
[████░░] 3/5  进行中
```

进度条宽度：8 个字符

| 进度 | 显示 |
|-----|------|
| 0% | [░░░░░░░░] |
| 25% | [██░░░░░░] |
| 50% | [████░░░░] |
| 75% | [██████░░] |
| 100% | [████████] |
