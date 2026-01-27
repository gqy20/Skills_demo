# Skill 生成器 (Skill Generator)

根据用户任务和用户画像，生成定制化的 Skill。

## 核心流程

### 1. 读取用户画像
读取 `.info/usr.json`，获取：
- 基本信息、技术栈
- 偏好风格、行为模式
- 目标与痛点

### 2. 分配任务编号
- 读取 `.info/tasks.json`
- 获取 `next_id`，生成编号 `k01`
- 更新 `next_id += 1`

### 3. 生成任务标识符
从任务描述中提取关键词，生成格式：`k01_task_name`
- 使用英文小写
- 用下划线连接
- 简洁明了

例如：
- "搭建 Next.js 博客" → `k01_nextjs_blog`
- "文章搜索功能" → `k02_article_search`
- "Git 工作流自动化" → `k03_git_automation`

### 4. 生成 Skill
基于任务描述 + 用户画像，生成：

```markdown
# [任务名称] (k01_nextjs_blog)

## 任务概述
[任务描述]

## 用户画像参考
- 技术栈: {用户的主要语言/框架}
- 工作风格: {用户的工作风格}
- 响应偏好: {用户偏好的响应方式}

## 执行步骤
[根据任务拆解步骤]
```

### 5. 保存文件
```
.claude/skills/k01_nextjs_blog/SKILL.md
.info/tasks.json (更新)
```

## tasks.json 结构
```json
{
  "next_id": 2,
  "tasks": {
    "k01_nextjs_blog": {
      "id": "k01_nextjs_blog",
      "name": "搭建 Next.js 博客",
      "description": "任务描述",
      "created_at": "2026-01-27T15:00:00Z"
    }
  }
}
```

## 使用方式
```
/new-skill [任务描述]
```

例如：
- `/new-skill 搭建 Next.js 博客`
- `/new-skill 文章搜索功能`
- `/new-skill Git 工作流自动化`
