# 用户画像各维度详细说明

## 基础信息 (basic_info)

| 字段 | 说明 | 示例 |
|------|------|------|
| `name` | 用户名称 | "张三" |
| `role` | 职业角色 | "前端工程师" |
| `domain` | 专业领域 | "frontend/web" |
| `location` | 所在地 | "北京" |
| `experience_level` | 经验等级 | "初级/中级/高级/专家" |

## 技术栈 (tech_stack)

### primary_languages
主要使用的编程语言列表。

**示例**:
```json
{
  "primary_languages": ["TypeScript", "Python", "Go"]
}
```

### frameworks
使用的框架和库。

**示例**:
```json
{
  "frameworks": ["React", "Next.js", "FastAPI"]
}
```

### tools
开发工具列表。

**示例**:
```json
{
  "tools": ["Git", "Docker", "NeoVim", "tmux"]
}
```

## 偏好风格 (preferences)

### code_style
代码风格偏好。

**示例**:
```json
{
  "code_style": {
    "naming": "camelCase for JS/TS, snake_case for Python",
    "formatting": "Prettier + ESLint",
    "comments": "只注释复杂逻辑"
  }
}
```

### communication_style
沟通风格偏好。

**选项**:
- "简洁直接" - 喜欢简短回复
- "详细说明" - 喜欢详细解释

### response_format
响应格式偏好。

**选项**:
- "代码优先" - 先给代码再解释
- "解释优先" - 先解释再给代码

## 行为模式 (behavioral_patterns)

### work_style
工作风格。

**选项**:
- "迭代式开发" - 快速验证，逐步完善
- "规划式开发" - 充分规划后再实现
- "敏捷开发" - 短迭代，频繁交付

### collaboration
协作偏好。

**选项**:
- "异步协作" - 喜欢异步沟通
- "同步协作" - 喜欢实时沟通

## 目标与痛点 (goals)

### current_focus
当前专注的方向。

**示例**:
- "AI Agent 开发"
- "前端性能优化"

### pain_points
遇到的技术痛点。

**示例**:
```json
{
  "pain_points": [
    "TypeScript 复杂类型推导",
    "异步编程复杂度"
  ]
}
```

### aspirations
长期职业志向。

**示例**:
- "成为全栈架构师"
- "开源项目维护者"
