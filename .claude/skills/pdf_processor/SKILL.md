---
name: pdf_processor
description: PDF 文献自动处理工具。功能：(1) 扫描 01_articles/ 目录中的 PDF 文件，(2) 使用 MinerU API 转换为 Markdown，(3) 使用 LLM API 生成摘要，(4) 状态跟踪和断点续传。
---

# Claude Instructions

当用户调用此 skill 时，执行以下步骤：

## 第一步：PDF → Markdown（脚本执行）

```python
import sys
sys.path.insert(0, '/workspaces/Skills_demo/.claude/skills/pdf_processor/scripts')
from processor import PDFProcessor

config = {
    'pdf_dir': '01_articles',
    'output_dir': '01_articles/processed',
    'status_file': '.info/.pdf_processing_status.csv',
}

processor = PDFProcessor(config)
results = processor.process_all_pdfs()
processor.generate_report(results)
```

## 第二步：读取 Markdown 并生成摘要（Claude Code 直接处理）

脚本执行后，检查哪些文件需要生成摘要，然后：

1. 读取 `01_articles/processed/md/*.md` 文件
2. 用 Claude Code 自身能力分析内容，生成摘要 JSON
3. 保存到 `01_articles/processed/summaries/*.json`

### 摘要 JSON 格式

```json
{
  "filename": "paper.pdf",
  "title": "论文完整标题",
  "authors": ["作者1", "作者2"],
  "abstract": "论文摘要原文",
  "summary": "中文通俗总结（200-300字）：研究什么问题、用了什么方法、主要发现、研究意义",
  "key_findings": ["发现1（中文）", "发现2（中文）"],
  "keywords": ["关键词1（中文）", "关键词2（中文）"],
  "metadata": {"word_count": 5000, "char_count": 10000},
  "generated_at": "2026-02-06T12:00:00Z",
  "model_used": "claude-sonnet-4-5-20250929"
}
```

### 示例 Prompt

```
分析这篇论文并输出 JSON：

论文：{filename}
内容：
{content}

要求：
- summary: 中文通俗总结，200-300字，说明研究问题、方法、主要发现和意义
- key_findings: 3-5个关键发现，用中文
- keywords: 3-5个关键词，用中文

只输出 JSON，不要其他文字。
```

## 当前状态检查

执行前可检查 `.info/.pdf_processing_status.csv` 确认哪些文件需要处理。

---

# 用户文档

自动处理 PDF 文献文件，转换为 Markdown 格式并生成 AI 摘要。

## 功能概述

| 功能 | 说明 |
|------|------|
| **PDF 扫描** | 扫描 `01_articles/` 目录，检测新文件 |
| **格式转换** | 使用 MinerU API 将 PDF 转为 Markdown |
| **AI 摘要** | 使用 LLM API 生成结构化摘要 |
| **并行处理** | 支持多线程并发处理多个 PDF |
| **状态跟踪** | 记录处理状态，支持断点续传 |

## 使用方法

```bash
python .claude/skills/pdf_processor/scripts/processor.py
```

## 输出结构

```
01_articles/
├── xxx.pdf
└── processed/
    ├── md/xxx.md
    └── summaries/xxx.json
```

摘要 JSON 结构见上方 Claude Instructions 部分。

## 状态文件

处理状态保存在 `.info/.pdf_processing_status.csv`。

## 技巧

- **批量处理**: 放入多个 PDF 后运行一次
- **并行加速**: 默认 5 个并发
- **断点续传**: 中断后重新运行会跳过已处理的文件
