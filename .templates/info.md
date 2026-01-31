# 意图路由规则

> 本文件通过 UserPromptSubmit hook 自动注入到上下文。

## 意图映射表（按优先级）

| 优先级 | 意图 | 触发模式 | 处理方式 |
|:-----:|-----|---------|---------|
| 1 | command | `/*` | 直接执行命令 |
| 2 | identity | 我是谁, 我的画像, 我的信息 | `Skill("user-profile")` |
| 3 | task-doc | 帮我写*本子/申报书/报告 | `Skill("commander", "start --type=doc {描述}")` |
| 3 | task-dev | 帮我写, 创建, 开发, 实现, 搭建 | `Skill("commander", "start --type=dev {描述}")` |
| 3 | task-research | 研究, 分析, 调研 | `Skill("commander", "start --type=research {描述}")` |
| 4 | question | 如何, 怎么, 什么是, 为什么 | 直接回答 |
| 5 | other | 不匹配以上 | 智能分析 |

## 处理流程

```
用户输入 → 检查优先级 → 匹配意图 → 执行处理方式
```

## 快速参考

- **身份查询** → `Skill("user-profile")`
- **文档任务** → `Skill("commander", "start --type=doc")`
- **开发任务** → `Skill("commander", "start --type=dev")`
- **研究任务** → `Skill("commander", "start --type=research")`
- **问题咨询** → 直接回答

## MCP 工具使用

本项目已启用 `enableAllProjectMcpServers: true`。

### 功能分类（按使用场景）

| 场景 | 可用能力 |
|-----|---------|
| 学术研究 | 文献搜索、全文获取、期刊质量评估、引用分析 |
| 网页处理 | 网页爬取、内容提取、Markdown 转换 |
| 信息检索 | 网页搜索、新闻搜索、图片搜索 |
| 多模态分析 | 图像/视频理解、OCR、图表解析、UI 分析 |
| 代码探索 | GitHub 仓库读取、文件浏览、文档搜索 |

### 使用方式

- **自动**：Claude 根据任务自动选择合适的 MCP 工具
- **查询**：运行 `/mcp` 查看当前可用的工具列表
- **配置**：MCP 服务器配置在 `~/.claude/settings.json`

### 注意事项

- MCP 工具随配置动态变化，以实际可用为准
- 某些工具有前置依赖（如文献全文需 PMCID）

## 时间感知

- 当前日期由系统提供（见 `<env>` 中的 `Today's date`）
- 涉及计划、截止日期、时效性任务时主动考虑时间因素
- 需要时可在输出中标注日期上下文

---

## 注意

1. 修改本文件后立即生效（下次输入时）
2. 详细处理逻辑在各 skill 中定义
3. 本文件会被频繁注入，请保持简洁
