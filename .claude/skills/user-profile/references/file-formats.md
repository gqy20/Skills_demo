# 文件格式说明

> **重要**：文件名可自定义，系统自动识别内容类型。无需按固定文件名组织。

## Markdown 文件 (.md)

### 适用场景

- 个人简介（任意文件名.md）
- 技能清单（任意文件名.md）
- 项目经验（任意文件名.md）
- 学习笔记（任意文件名.md）
- 对话记录（Continue/Cursor 会话导出）

### 解析规则

#### 标题解析

```markdown
# 张三              → basic_info.name
## 关于我           → 识别为基本信息部分
### 编程语言        → tech_stack.primary_languages
- TypeScript       → 提取为语言
- Python           → 提取为语言
```

#### 列表解析

```markdown
## 技术栈

### 编程语言
- TypeScript
- Python
→ tech_stack.primary_languages = ["TypeScript", "Python"]

### 框架
- React
- Next.js
→ tech_stack.frameworks = ["React", "Next.js"]
```

#### 代码块解析

```markdown
```typescript
interface User {
  id: number;
  name: string;
}
```
→ 推断 tech_stack.primary_languages 包含 TypeScript
→ 推断 preferences.code_style 使用 TypeScript 风格
```

#### 链接解析

```markdown
- [GitHub](https://github.com/user)
→ 提取社交链接（如需）
```

### 示例文件结构

**文件名可任意**，例如：
- `我的个人简介.md`
- `技术栈总结.md`
- `用了3个月近百个Skills最后只剩下这些.md`

```markdown
# 张三

## 基本信息
- 角色：前端工程师
- 经验：5年
- 所在地：北京

## 技术栈

### 编程语言
- TypeScript
- Python

### 框架
- React
- Next.js

## 兴趣方向
- 前端性能优化
- 可视化开发
```

### 关键说明

> 文件名不重要，内容格式最重要。系统会自动扫描 `info/` 目录下的所有 `.md` 文件并提取信息。

## JSON 文件 (.json)

### 适用场景

- 结构化配置
- 技能清单
- 偏好设置

### 解析规则

直接读取 JSON 结构，合并到用户画像。

#### 合并策略

```python
# 字段级别合并
def merge_profile(existing, new_data):
    for key, value in new_data.items():
        if isinstance(value, dict):
            existing[key] = merge_profile(existing.get(key, {}), value)
        elif isinstance(value, list):
            existing[key] = list(set(existing.get(key, []) + value))
        else:
            existing[key] = value
    return existing
```

### 示例文件

```json
{
  "tech_stack": {
    "primary_languages": ["TypeScript", "Python"],
    "frameworks": ["React", "Next.js"]
  },
  "preferences": {
    "code_style": {
      "naming_convention": "camelCase",
      "indent_size": 2
    }
  }
}
```

## PDF 文件 (.pdf)

### 适用场景

- 简历 (resume.pdf)
- 技术文档
- 证书文件

### 解析规则

#### 简历类 PDF

```
提取内容：
1. 个人信息 → basic_info
2. 工作经历 → 推断经验等级
3. 技能列表 → tech_stack
4. 项目经验 → goals.current_focus
```

#### 文档类 PDF

```
提取内容：
1. 技术规格 → tech_stack
2. 专业术语 → 推断专业领域
3. 工具列表 → tech_stack.tools
```

#### 表格类 PDF

```
提取内容：
1. 技能矩阵 → tech_stack
2. 工具链 → tech_stack.tools
3. 版本信息 → 推断技术熟悉度
```

### PDF 提取示例

```
原始内容：
┌─────────────────────────────┐
│ 姓名：张三                   │
│ 职位：前端工程师             │
│ 技能：                       │
│ - TypeScript (熟练)          │
│ - React (精通)              │
└─────────────────────────────┘

提取结果：
basic_info.name = "张三"
basic_info.role = "前端工程师"
tech_stack.primary_languages = ["TypeScript"]
tech_stack.frameworks = ["React"]
```

## TXT 文件 (.txt)

### 适用场景

- 快速笔记
- 随笔记录
- 灵感记录

### 解析规则

#### 自由文本解析

```
1. 按行分割
2. 识别关键词模式
3. 推断信息类型
```

#### 关键词模式

| 模式 | 匹配 | 映射 |
|-----|------|------|
| `我叫.*` | 自我介绍 | basic_info.name |
| `使用.*开发` | 技术描述 | tech_stack |
| `擅长.*` | 技能描述 | tech_stack |

### 示例

```
原始内容：
我叫张三，是一名前端工程师。
主要使用 TypeScript 和 React 开发。
最近在学习 Rust。

提取结果：
basic_info.name = "张三"
basic_info.role = "前端工程师"
tech_stack.primary_languages = ["TypeScript"]
tech_stack.frameworks = ["React"]
tech_stack.learning_interests = ["Rust"]
```

## 文件优先级

| 优先级 | 文件类型 | 说明 |
|-------|---------|------|
| 高 | .json | 结构化，优先使用 |
| 中 | .md | 格式清晰，易于解析 |
| 中 | .pdf | 需 OCR/文本提取 |
| 低 | .txt | 自由格式，解析难度高 |

## 多文件合并

```
info/
├── 我的个人简介.md        # 提供基本信息
├── 技术栈总结.json        # 提供技术栈
├── 我的简历.pdf           # 补充工作经历
└── 随手笔记.txt           # 补充兴趣方向

# 文件名可自定义，系统自动识别内容类型
```

### 合并策略

1. 优先使用 `.json` 的结构化数据
2. 用 `.md` 补充详细信息
3. 用 `.pdf` 提取额外信息
4. 用 `.txt` 填充缺失字段

### 关键原则

> **无需按固定文件名组织** - 随意将文件放入 `info/` 目录，系统会自动扫描所有文件并提取信息。
