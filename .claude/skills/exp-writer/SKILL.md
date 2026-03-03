---
name: exp-writer
description: 将当前任务上下文整理为结构化经验贴并保存到指定目录。用于“写复盘、整理经验、沉淀踩坑、归档知识”等请求。输出标准 frontmatter 与固定章节，自动生成唯一 ID 与文件名，默认保存到 ~/.exp。
---

# Exp Writer

按以下流程执行，确保经验贴可复用、可检索、可持续维护。

## 1. 收集上下文证据

从当前会话与工作区提取：

- 背景目标
- 现象与影响
- 根因与排查路径
- 解决方案与关键改动
- 验证结果
- 后续行动项

信息不足时标注 `待补充`，不要编造。

## 2. 生成标准文档结构

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
- `root_cause`
- `actions`
- `evidence_links`

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
3. 根因分析  
4. 解决方案  
5. 验证与结果  
6. 踩坑与反模式  
7. Action Items（owner + due date）  
8. 关联资料

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
- 未提供时，默认保存到 `~/.exp/`。
- 不覆盖已有文件，冲突时自动生成新文件名。

## 5. 质量门槛

发布前检查：

- 有明确结论（前 3 段可读懂）
- 有可复现证据（命令/路径/链接）
- 有可执行行动项（负责人 + 截止日期）
- 无敏感信息泄露（密钥/账号/隐私已脱敏）
- `status=published` 前至少一次 review

## 6. 最小脚本建议

仅保留一个基础脚本：

- `scripts/new_post.sh`：创建文档、填充元数据、生成唯一 `id` 与文件名。

模板文件：

- `assets/post-template.md`：标准 frontmatter 与固定章节骨架。
