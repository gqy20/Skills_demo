---
name: exp-writer
description: 将当前任务上下文整理为结构化经验贴并保存到指定目录。用于“写复盘、整理经验、沉淀踩坑、归档知识”等请求。输出标准 frontmatter 与固定章节，自动生成唯一 ID 与文件名，默认保存到 ./knowledge/exp。
---

# Exp Writer

按以下流程执行，确保经验贴可复用、可检索、可持续维护。

## 1. 收集上下文证据

从当前会话与工作区提取：

- 背景目标
- 现象与影响
- 排查/思路时间线（观察 -> 假设 -> 验证 -> 结论）
- 根因与决策理由（为什么选当前方案）
- 解决方案与关键改动
- 验证结果
- 后续行动项

信息不足时标注 `待补充`，不要编造。

## 2. 生成标准文档结构（Obsidian 友好）

输出 Markdown，格式为 `YAML frontmatter + 固定章节正文`。

### 2.1 Frontmatter 字段

必填字段：

- `id`（唯一主键，格式：`exp-YYYYMMDD-xxxx`）
- `title`
- `date`
- `doc_type`（`postmortem | howto | reference`）
- `status`（`draft | reviewed | published | deprecated`）
- `owner`
- `tags`
- `summary`
- `impact`
- `service`（服务名）
- `module`（模块名）
- `env`（`prod | staging | test | dev`）
- `version`（受影响版本）
- `problem_signature`（对象，包含 `error_code/keyword/log/trigger` 四个子字段）
- `root_cause`
- `decision_rationale`（选择当前方案的理由）
- `actions`（列表，元素结构：`owner/due/item/status`）
- `evidence_links`（列表）
- `applies_to`（适用范围）
- `not_applies_to`（不适用范围）
- `verification_steps`（列表，验证步骤）
- `success_criteria`（列表，成功判定标准）

可选字段：

- `reviewer`
- `severity`（`low | medium | high`）
- `repo`
- `paths`
- `last_verified_at`
- `review_date`
- `visibility`（`team | internal | restricted`）

### 2.2 正文章节

1. 背景与目标  
2. 现象与影响  
3. 排查/思路时间线（观察 -> 假设 -> 验证 -> 结论）  
4. 根因分析  
5. 方案对比与决策理由  
6. 最终方案  
7. 验证与结果  
8. 踩坑与反模式  
9. Action Items（`doc_type=postmortem` 必填，其他类型可写 `无`）  
10. 关联资料

### 2.3 最终方案写法（第 6 节）

第 6 节固定包含以下小节，避免 AI 二次猜测：

- `changes`：改了什么（代码/配置/数据）
- `prerequisites`：前置条件（依赖、权限、开关）
- `rollback`：失败时如何回滚

## 3. 唯一性与命名规则

文件名格式：

- `YYYY-MM-DD-<topic-slug>-<shortid>.md`

示例：

- `2026-03-03-cache-invalidation-a7k2.md`

规则：

- 标题允许重复，但文件名必须唯一。
- 若目标目录存在同名文件，重新生成 `shortid`。
- 去重主键使用 `id`，不要使用 `title`。

## 4. 落盘规则

- 用户提供 `target_dir` 时，保存到该路径。
- 未提供时，默认保存到 `./knowledge/exp/`（建议该目录位于 Obsidian Vault 内）。
- 不覆盖已有文件，冲突时自动生成新文件名。

## 5. 质量门槛

发布前检查：

- 有明确结论（前 3 段可读懂）
- 有问题指纹（标题包含 `[模块/系统] + 关键词`）
- `tags` 包含模块或场景信息，至少 2 个标签
- `service/module/env/version` 非空，且与正文一致
- `problem_signature.error_code/keyword/log/trigger` 至少 1 个非空，且包含关键报错或关键现象
- 有可复现证据（命令/路径/链接）
- `verification_steps` 为可执行步骤列表（命令级或操作级）
- `success_criteria` 为量化判定列表（阈值/状态/数量）
- `doc_type=postmortem` 时有可执行行动项（负责人 + 截止日期）
- 无敏感信息泄露（密钥/账号/隐私已脱敏）
- `status=published` 前至少一次 review，且必须满足：
  - `problem_signature` 至少 1 个子字段非空
  - `decision_rationale` 非空
  - `verification_steps` 至少 1 条
  - `success_criteria` 至少 1 条
  - `evidence_links` 至少 1 条

## 6. 最小脚本建议

仅保留一个基础脚本：

- `scripts/new_post.sh`：创建文档、填充元数据、生成唯一 `id` 与文件名。

模板文件：

- `assets/post-template.md`：标准 frontmatter 与固定章节骨架。
