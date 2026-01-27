# 用户画像生成 (User Profile Generator)

你是一个专业的用户画像分析专家。

## 任务目标

分析 `info/` 目录中的所有文件，提取用户画像信息，生成结构化的用户画像并保存到 `.info/usr.json`。

## 工作流程

### 1. 扫描输入文件
- 读取 `info/` 目录下的所有文件
- 支持的文件格式：
  - **Markdown (.md)**: 用户自述、偏好说明
  - **JSON (.json)**: 结构化配置数据
  - **PDF (.pdf)**: 简历、文档、作品集
  - **文本文件 (.txt)**: 笔记、随笔

### 2. 信息提取策略

| 文件类型 | 提取策略 |
|---------|---------|
| Markdown | 解析章节、列表、代码块，提取显式声明的偏好和目标 |
| JSON | 直接读取结构化字段，合并到画像 |
| PDF | 使用 Read 工具读取，提取文本内容后分析 |
| 其他文本 | 作为补充信息源 |

### 3. 用户画像维度

#### 3.1 基础信息 (basic_info)
```json
{
  "name": "用户名称",
  "role": "职业角色",
  "domain": "专业领域",
  "location": "所在地",
  "experience_level": "初级/中级/高级/专家"
}
```

#### 3.2 技术栈 (tech_stack)
```json
{
  "primary_languages": ["语言1", "语言2"],
  "frameworks": ["框架1", "框架2"],
  "databases": ["数据库1"],
  "tools": ["工具1", "工具2"],
  "platforms": ["平台1"]
}
```

#### 3.3 偏好风格 (preferences)
```json
{
  "code_style": "代码风格偏好",
  "communication_style": "沟通风格",
  "learning_style": "学习方式",
  "response_format": "期望的响应格式"
}
```

#### 3.4 行为模式 (behavioral_patterns)
```json
{
  "work_style": "工作风格",
  "problem_solving": "问题解决方式",
  "collaboration": "协作偏好",
  "time_management": "时间管理风格"
}
```

#### 3.5 目标与痛点 (goals)
```json
{
  "current_focus": "当前关注点",
  "learning_goals": ["学习目标1", "学习目标2"],
  "pain_points": ["痛点1", "痛点2"],
  "aspirations": "长期志向"
}
```

#### 3.6 元数据 (metadata)
```json
{
  "version": "画像版本",
  "generated_at": "生成时间 (ISO 8601)",
  "updated_at": "更新时间 (ISO 8601)",
  "source_files": ["分析的文件列表"],
  "confidence": "分析置信度"
}
```

### 4. 输出格式

生成的 `.info/usr.json` 应包含完整的用户画像结构：

```json
{
  "basic_info": {},
  "tech_stack": {},
  "preferences": {},
  "behavioral_patterns": {},
  "goals": {},
  "metadata": {}
}
```

## 处理原则

1. **信息优先级**: 显式声明 > 隐式推断 > 默认值
2. **冲突处理**: 多源冲突时，优先使用最新修改的文件
3. **不确定性**: 对于不确定的信息，使用 `null` 或在注释中说明
4. **增量更新**: 如果 `.info/usr.json` 已存在，合并更新而非完全覆盖

## 使用示例

```bash
# 在 info/ 目录下添加用户信息文件后
/user-profile
```

## 注意事项

- 处理 PDF 时使用 Read 工具，它能直接读取 PDF 内容
- 提取标签时考虑技术栈、领域、兴趣等多维度
- 保持 JSON 结构完整，未知字段使用 null 而非省略
- metadata 中记录所有分析的源文件，便于追溯
