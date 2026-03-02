# 信息提取规则详解

## Markdown 文件提取

### 标题解析
```markdown
# 主要标题 → basic_info.name 或 main_focus
## 子标题 → 对应到各维度
- 列表项 → 提取为数组
- 代码块 → 提取代码风格和工具
```

### 列表解析
```markdown
## 编程语言
- TypeScript
- Python
→ tech_stack.primary_languages = ["TypeScript", "Python"]
```

## JSON 文件提取

直接读取结构化字段，合并到用户画像。

### 合并策略
- 字段级别合并：`Object.assign(existing, new_data)`
- 数组级别合并：`Array.from(new Set([...existing, ...new]))`

### Zotero MCP 自动提取规则

当 `zotero-mcp` 可用且密钥条件满足时，自动调用工具并按以下高可信映射写入：

| Zotero 聚合字段 | 目标字段 |
|---------------|---------|
| `source = "zotero"` | `research_profile.source` |
| `item_count` | `research_profile.item_count` |
| `top_topics` | `research_profile.top_topics` |
| `top_authors` | `research_profile.top_authors` |
| `top_journals` | `research_profile.top_journals` |
| `year_distribution` | `research_profile.year_distribution` |

元数据同步：

| 条件 | 目标字段 |
|------|---------|
| Zotero 增强成功 | `metadata.source_systems += ["zotero"]` |
| Zotero 增强成功 | `metadata.confidence_breakdown.zotero_based = "high"` |
| Zotero 增强跳过/失败 | `metadata.confidence_breakdown.zotero_based = "unknown"` |

约束：
1. 仅接受聚合统计字段，不接受主观推断字段。
2. 数组字段去重、保序。
3. `year_distribution` 仅保留数字年份键和值为非负整数的项。
4. 失败时只记录降级状态，不中断主画像生成流程。

## PDF 文件提取

使用 Read 工具读取内容后分析：

1. **简历类 PDF**
   - 提取：姓名、经历、技能
   - 识别：工作时间线、项目经验

2. **文档类 PDF**
   - 提取：技术规格、架构设计
   - 识别：知识领域、专业术语

3. **表格类 PDF**
   - 提取：结构化数据
   - 识别：工具链、版本信息

## 冲突处理

### 信息优先级
1. **显式声明** > 隐式推断 > 默认值
2. **多源冲突时**：优先使用最新修改的文件

### 不确定性处理
- 不确定的信息使用 `null`
- 在 comments 中标注不确定的原因

## 文件时间戳记录

记录每个源文件的修改时间：

```json
{
  "source_mtimes": {
    "info/bio.md": 1769525813,
    "info/skills.md": 1769525813,
    "info/preferences.json": 1769525813
  }
}
```

用于判断用户画像是否需要更新。
