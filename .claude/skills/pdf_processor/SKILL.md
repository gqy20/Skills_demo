---
name: u_pdf_processor
description: PDF 文献自动处理工具。功能：(1) 扫描 01_articles/ 目录中的 PDF 文件，(2) 使用 MinerU API 转换为 Markdown，(3) 使用 Claude API 生成 AI 摘要，(4) 状态跟踪和断点续传。
---

# PDF 文献处理器

自动处理 PDF 文献文件，转换为 Markdown 格式并生成 AI 摘要。

## 功能概述

| 功能 | 说明 |
|------|------|
| **PDF 扫描** | 扫描 `01_articles/` 目录，检测新文件 |
| **格式转换** | 使用 MinerU API 将 PDF 转为 Markdown + 图片 |
| **AI 摘要** | 使用 Claude API 生成结构化摘要 |
| **并行处理** | 支持多线程并发处理多个 PDF |
| **状态跟踪** | 记录处理状态，支持断点续传 |
| **去重机制** | 已处理的文件不会重复转换 |

## 使用方法

```bash
# 运行处理器
python .claude/skills/pdf_processor/scripts/processor.py
```

## 处理流程

```
1. 扫描 01_articles/ 目录
   ↓
2. 检查处理状态
   ↓
3. 检查 MD 文件是否有效
   ├── 有效 → 重用现有 MD
   └── 无效 → 调用 MinerU 转换
   ↓
4. 生成 AI 摘要（如果配置了 API）
   ↓
5. 保存结果并更新状态
```

## 输出结构

```
01_articles/
├── xxx.pdf                    # 原始 PDF
└── processed/
    ├── md/
    │   └── xxx.md             # 转换后的 Markdown
    ├── imgs/
    │   └── xxx/               # 提取的图片
    │       └── figure-1.png
    └── summaries/
        └── xxx.json           # AI 生成的摘要
```

## 配置

需要在 `.env` 文件中配置：

```bash
# MinerU API (必需)
MINERU_API_KEY=your_mineru_api_key

# Claude API (可选，用于生成摘要)
ANTHROPIC_AUTH_TOKEN=your_anthropic_api_key
ANTHROPIC_MODEL=claude-sonnet-4-5-20250929
ANTHROPIC_BASE_URL=https://api.anthropic.com

# 并行处理配置 (可选)
PDF_MAX_WORKERS=5              # 并发处理数量，默认 5
PDF_ENABLE_PARALLEL=true       # 是否启用并行处理，默认 true
```

获取 API Key:
- MinerU: https://mineru.net/apiManage
- Anthropic: https://console.anthropic.com/

## 摘要 JSON 结构

```json
{
  "filename": "paper.pdf",
  "title": "论文标题",
  "authors": ["作者1", "作者2"],
  "abstract": "论文摘要内容",
  "summary": "论文通俗总结（中文，200-300字）",
  "key_findings": ["关键发现1", "关键发现2"],
  "keywords": ["关键词1", "关键词2"],
  "metadata": {
    "page_count": 10,
    "has_images": true,
    "image_count": 5,
    "word_count": 5000
  },
  "generated_at": "2026-02-06T12:00:00Z",
  "model_used": "claude-sonnet-4-5-20250929"
}
```

## 状态文件

处理状态保存在 `.info/.pdf_processing_status.csv`：

| 字段 | 说明 |
|------|------|
| filename | PDF 文件名 |
| md_converted | 是否成功转换 |
| summary_generated | 是否生成摘要 |
| md_path | Markdown 文件路径 |
| images_dir | 图片目录路径 |
| summary_path | 摘要文件路径 |
| error_message | 错误信息 |
| processing_time | 处理耗时(秒) |
| md_file_reused | 是否重用了现有 MD |

## 错误处理

| 错误 | 原因 | 解决方案 |
|------|------|----------|
| API 认证失败 | API Key 无效/过期 | 更新 `.env` 中的 API Key |
| PDF 处理失败 | 文件损坏或格式不支持 | 检查 PDF 文件完整性 |
| 摘要生成失败 | Claude API 不可用 | 检查 ANTHROPIC_AUTH_TOKEN |

## 技巧

- **批量处理**: 放入多个 PDF 后运行一次即可，自动并行处理
- **并行加速**: 默认 5 个并发，可通过 `PDF_MAX_WORKERS` 调整
- **断点续传**: 中断后重新运行会跳过已处理的文件
- **仅转换**: 不配置 Claude API 时，只转换 PDF 不生成摘要
- **查看状态**: 查看 `.info/.pdf_processing_status.csv` 了解处理进度
