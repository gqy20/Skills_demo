# 命令详细说明

## `/commander start [任务描述]`

启动新任务。

### 前置检查

在启动任务前，自动执行以下检查：

```
1. 检查 .info/usr.json 是否存在
   └─ 不存在 → 提示运行 /user-profile

2. 读取 usr.json.metadata.last_checked_at
   └─ 与 info/ 目录文件比较修改时间

3. 检查 info/ 目录是否有新文件
   └─ 有新文件 → 提示运行 /user-profile 更新
```

### 处理流程

| 步骤 | 操作 | 说明 |
|-----|------|------|
| 1 | 读取 tasks.json | 获取 next_id 和现有任务列表 |
| 2 | 分配任务 ID | 格式：k01, k02, k03... |
| 3 | 调用 skill-generator | 拆解任务，生成子技能列表 |
| 4 | 显示计划 | 展示任务步骤，等待用户确认 |
| 5 | 创建目录结构 | 创建 results/k01/ 目录 |
| 6 | 生成子技能 | 为每个步骤创建独立的 skill |
| 7 | 更新 tasks.json | 记录新任务信息 |
| 8 | 创建 README.md | 在 results/k01/ 中创建任务总览 |

### 输出示例

```
═══════════════════════════════════════════════════════
新任务创建
═══════════════════════════════════════════════════════

任务 ID: k01
任务名称: 搭建 Next.js 博客
任务类型: web

执行步骤:
  1. k01_init_project    初始化项目
  2. k01_config_mdx      配置 MDX
  3. k01_create_layout   创建布局
  4. k01_article_list    文章列表
  5. k01_deploy          部署配置

是否确认创建此任务？[y/n]
```

## `/commander status`

显示全局状态概览。

### 输出格式

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

### 数据来源

- 用户画像状态：检查 `.info/usr.json` 存在性及时间戳
- 任务统计：统计 `.info/tasks.json` 中的任务状态

## `/commander progress k01`

显示特定任务的详细进度。

### 输出内容

| 信息 | 来源 |
|-----|------|
| 任务基本信息 | tasks.json |
| 当前进度 | tasks.json.current_step |
| 执行记录 | results/k01/execution.md |
| 最新笔记 | results/k01/notes.md |

### 输出示例

```
═══════════════════════════════════════════════════════
k01 任务进度
═══════════════════════════════════════════════════════

任务名称: 搭建 Next.js 博客
当前状态: 进行中
进度: 3/5 步骤

已完成步骤:
  ✓ k01_init_project    初始化项目
  ✓ k01_config_mdx      配置 MDX
  ✓ k01_create_layout   创建布局

当前步骤:
  → k01_article_list    文章列表

待执行步骤:
  ⏭ k01_deploy          部署配置

最新笔记:
  - MDX 配置已完成，支持 frontmatter
  - 布局组件使用 Tailwind CSS

═══════════════════════════════════════════════════════
```

## `/commander list`

列出所有任务及其简要状态。

### 输出示例

```
ID    任务名称              状态      进度
k01   搭建 Next.js 博客     进行中    3/5
k02   文章搜索功能          进行中    1/4
k03   用户认证系统          已完成    5/5
```

## `/commander results k01`

显示任务结果文件。

### 操作

1. 列出 `results/k01/` 目录内容
2. 显示每个文件的简要说明
3. 询问用户是否查看某个文件

### 输出示例

```
results/k01/
├── README.md       # 任务总览
├── plan.md         # 任务计划
├── execution.md    # 执行记录 (3 条)
├── notes.md        # 笔记 (2 条)
└── artifacts/      # 生成的文件 (5 个)

查看哪个文件？[文件名 / skip]
```

## `/commander continue k01`

继续执行任务的下一步。

### 流程

1. 读取 tasks.json，获取 current_step
2. 显示当前步骤信息
3. 执行对应的子技能
4. 更新 current_step
5. 更新 execution.md

## `/commander complete k01`

手动标记任务为已完成。

### 操作

1. 更新 tasks.json.status = "completed"
2. 在 results/k01/README.md 添加完成时间
3. 提示是否归档

## `/commander archive k01`

归档已完成任务。

### 操作

1. 检查任务状态为 "completed"
2. 移动 results/k01/ → results/archived/k01/
3. 更新 tasks.json.status = "archived"
