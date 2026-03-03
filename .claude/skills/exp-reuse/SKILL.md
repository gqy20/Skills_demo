---
name: exp-reuse
description: 从历史经验贴中检索可复用方案并输出候选清单。用于“找相似问题、复用排查步骤、参考已验证方案”等请求，默认检索 ./knowledge/exp。
---

# Exp Reuse

按以下最小流程执行，优先给出可直接复用的经验贴。

## 1. 输入与范围

- 必填：`query`（问题关键词，建议包含模块/报错/现象）
- 可选：`target_dir`（默认 `./knowledge/exp`）
- 可选：`limit`（默认 `5`）

## 2. 检索

优先执行脚本：`scripts/find_reuse.sh "<query>" [target_dir] [limit]`

脚本会对每篇 Markdown 经验贴按以下字段打分：

- `title`
- `summary`
- `module`
- `service`
- `problem_signature`
- 全文关键词命中
- `verification_steps` 非空（加权）
- `status=deprecated`（降权）

## 3. 分析与决策（增强层）

执行完 find_reuse.sh 后，LLM 需要分析并决策：

### 3.1 用户意图分析

根据 `query` 判断用户想要什么：

| 意图类型 | 关键特征 | 应读取章节 |
|---------|---------|-----------|
| 排查问题 | 怎么解决、为什么出错、错误原因 | 排查时间线、根因分析、验证步骤 |
| 复用一个方案 | 怎么实现、步骤是什么 | 最终方案、changes、prerequisites |
| 防止复发 | 如何避免、注意什么 | 踩坑与反模式、applies_to |
| 回滚操作 | 失败了怎么办 | rollback 部分 |
| 参考决策 | 为什么要选这个 | 方案对比、decision_rationale |

### 3.2 候选选择策略

不只选 Top-1，根据情况选择：

1. **单一高匹配**：Top-1 score >= 8 → 直接读取 Top-1
2. **多维度参考**：
   - 排查问题：读取 Top-3（不同角度的排查思路）
   - 方案复用：读取 Top-2（主方案 + 变体）
3. **组合读取**：
   - Top-1 读全文
   - Top-2~3 读 frontmatter + 关键章节

### 3.3 章节读取决策

对每个候选，决定读取哪些部分：

```
读取优先级（按意图）:
- 排查问题: 排查时间线 > 根因分析 > 验证步骤 > 最终方案
- 方案复用: 最终方案 > changes > prerequisites > rollback
- 防止复发: applies_to > 踩坑与反模式 > not_applies_to
- 回滚操作: rollback > prerequisites > changes
```

### 3.4 读取执行

使用脚本或 Read 工具读取指定文件的指定章节：

**方式 1：脚本提取（推荐）**
```bash
# 提取多个指定章节
scripts/extract_sections.sh <file> "排查时间线" "验证步骤" "rollback"
```

**方式 2：手动定位**
- 先用 `grep -n "## " <file>` 定位章节
- 用 Read 工具按需读取（limit/offset）

## 5. 输出格式（固定）

### 5.1 候选清单（初步）

输出 Top-N 候选，每条包含：

- `path`
- `title`
- `score`
- `match_reason`（命中字段）
- `reuse_hint`（一句话：建议优先复用哪一部分，如验证步骤/回滚策略）

若无结果，输出：

- 已检索目录
- 已使用关键词
- 改写建议（扩展关键词、移除过窄条件）

### 5.2 增强输出（融入上下文）

在 3.4 节读取执行后，输出增强内容：

```
## 参考：《{title}》
- 来源：{path}
- 匹配字段：{match_reason}
- 适用场景：{applies_to}

### {相关章节标题}
{章节内容摘要或全文}
```

## 6. 复用边界

- 仅作为参考，不直接覆盖当前结论。
- 若候选文档 `status=deprecated`，只能作为反例参考。
- 输出时明确“适用范围/不适用范围”缺失项为 `待补充`，不得编造。
