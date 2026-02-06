#!/usr/bin/env python3
"""
基于 Anthropic Claude API 的论文摘要生成器
"""

import os
import json
import logging
import time
import re
from typing import Dict, Optional, List
from dataclasses import dataclass, asdict
from datetime import datetime
import requests
from dotenv import load_dotenv

load_dotenv()

@dataclass
class PaperSummary:
    """论文摘要数据结构"""
    filename: str
    title: str
    authors: List[str]
    abstract: str
    summary: str  # 新增：通俗总结，用易懂语言解释论文
    key_findings: List[str]
    keywords: List[str]
    metadata: Dict
    generated_at: str
    model_used: str

    def to_json(self) -> str:
        """转换为 JSON 字符串"""
        return json.dumps(asdict(self), ensure_ascii=False, indent=2)


class AnthropicSummarizer:
    """基于 Anthropic Claude API 的论文摘要生成器"""

    DEFAULT_MODEL = "claude-sonnet-4-5-20250929"
    API_BASE = "https://api.anthropic.com"

    def __init__(
        self,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
        base_url: Optional[str] = None
    ):
        """
        初始化摘要生成器

        Args:
            api_key: Anthropic API 密钥，默认从环境变量 ANTHROPIC_AUTH_TOKEN 读取
            model: 模型名称，默认从环境变量 ANTHROPIC_MODEL 读取
            base_url: API 基础 URL，默认从环境变量 ANTHROPIC_BASE_URL 读取
        """
        self.api_key = api_key or os.getenv('ANTHROPIC_AUTH_TOKEN') or os.getenv('ANTHROPIC_API_KEY')
        self.model = model or os.getenv('ANTHROPIC_MODEL', self.DEFAULT_MODEL)
        self.api_base = base_url or os.getenv('ANTHROPIC_BASE_URL', self.API_BASE)

        self.enabled = bool(self.api_key)
        self.timeout = 180
        self.max_retries = 3
        self.max_tokens = 4000

        if not self.enabled:
            logging.warning("未配置 ANTHROPIC_API_KEY，摘要功能将被跳过")

    def _create_prompt(self, md_content: str, metadata: Dict) -> str:
        """创建摘要生成的 Prompt"""
        # 限制内容长度，避免超出 token 限制
        max_chars = 20000
        if len(md_content) > max_chars:
            md_content = md_content[:max_chars] + "\n\n...(内容已截断)"

        prompt = f"""请分析以下论文内容，提取关键信息并生成结构化摘要。

## 论文元数据
- 文件名: {metadata.get('filename', 'Unknown')}

## 论文内容
{md_content}

## 输出要求
请以 JSON 格式返回，包含以下字段：
{{
  "title": "论文标题（完整原文）",
  "authors": ["作者1", "作者2", ...],
  "abstract": "论文摘要内容（从原文提取，保持原文）",
  "summary": "论文通俗总结（用中文，200-300字）：用通俗易懂的语言解释这篇论文研究什么问题、用了什么方法、有什么重要发现、有什么意义。适合非专业人士快速了解论文核心内容。",
  "key_findings": ["关键发现1（中文）", "关键发现2（中文）", ...],
  "keywords": ["关键词1（中文）", "关键词2（中文）", ...]
}}

注意事项：
1. title: 提取论文的完整标题，保持原文（英文论文保留英文标题）
2. authors: 提取所有作者姓名，返回字符串列表
3. abstract: 从论文中提取原文摘要部分，保持原文表述
4. summary: 用**中文**写通俗总结，包括研究问题、研究方法、主要发现、研究意义，200-300字
5. key_findings: 用**中文**提炼3-5个最重要的研究发现、结论或贡献
6. keywords: 用**中文**提取3-8个关键词或主题词

**只返回 JSON，不要有任何解释文字。**"""
        return prompt

    def _call_claude_api(self, prompt: str) -> Optional[str]:
        """调用 Anthropic Claude API"""
        if not self.enabled:
            return None

        headers = {
            'x-api-key': self.api_key,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
            # 'anthropic-dangerous-direct-browser-access': 'true'  # 如果需要浏览器访问
        }

        data = {
            'model': self.model,
            'max_tokens': self.max_tokens,
            'messages': [
                {
                    'role': 'user',
                    'content': prompt
                }
            ],
            'temperature': 0.3
        }

        url = f"{self.api_base.rstrip('/')}/v1/messages"

        for attempt in range(self.max_retries):
            try:
                response = requests.post(
                    url,
                    headers=headers,
                    json=data,
                    timeout=self.timeout
                )
                response.raise_for_status()

                result = response.json()
                content = result['content'][0]['text']
                return content

            except requests.exceptions.Timeout:
                logging.warning(f"API 超时 (尝试 {attempt + 1}/{self.max_retries})")
                if attempt < self.max_retries - 1:
                    time.sleep(3)
            except requests.exceptions.HTTPError as e:
                if e.response.status_code == 401:
                    logging.error("Anthropic API 认证失败，请检查 API Key")
                    return None
                elif e.response.status_code == 429:
                    retry_after = e.response.headers.get('retry-after', 5)
                    logging.warning(f"API 限流，等待 {retry_after} 秒后重试")
                    time.sleep(int(retry_after))
                    continue
                else:
                    logging.error(f"API 请求失败: {e.response.status_code} - {e.response.text[:200]}")
                    return None
            except (KeyError, IndexError, json.JSONDecodeError) as e:
                logging.error(f"API 响应格式错误: {e}")
                return None

        return None

    def _parse_response(self, response: str) -> Optional[Dict]:
        """解析 API 响应"""
        if not response:
            return None

        # 清理可能的 markdown 代码块标记
        response = response.strip()

        try:
            # 尝试直接解析 JSON
            return json.loads(response)
        except json.JSONDecodeError:
            pass

        # 尝试提取 JSON 代码块（```json 或 ```）
        match = re.search(r'```(?:json)?\s*\n?(.*?)\n?```', response, re.DOTALL | re.IGNORECASE)
        if match:
            try:
                return json.loads(match.group(1).strip())
            except json.JSONDecodeError:
                pass

        # 尝试提取花括号内容（整个响应是 JSON）
        match = re.search(r'\{.*\}', response, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                pass

        logging.error(f"无法解析 API 响应，响应内容: {response[:500]}...")
        return None

    def _extract_metadata_from_md(self, md_content: str) -> Dict:
        """从 Markdown 内容提取元数据"""
        metadata = {
            'page_count': 0,
            'has_images': False,
            'image_count': 0,
            'has_tables': False,
            'word_count': len(md_content.split()),
            'char_count': len(md_content)
        }

        # 统计图片
        images = re.findall(r'!\[.*?\]\(.*?\)', md_content)
        metadata['image_count'] = len(images)
        metadata['has_images'] = len(images) > 0

        # 统计表格
        table_rows = re.findall(r'^\|.*\|', md_content, re.MULTILINE)
        metadata['has_tables'] = len(table_rows) > 6
        metadata['table_rows'] = len(table_rows)

        # 估算页数（粗略估计，平均每页 500 词）
        metadata['page_count'] = max(1, metadata['word_count'] // 500)

        return metadata

    def generate_summary(
        self,
        md_content: str,
        metadata: Dict
    ) -> Optional[PaperSummary]:
        """
        生成论文摘要

        Args:
            md_content: Markdown 格式的论文内容
            metadata: 论文元数据（文件名等）

        Returns:
            PaperSummary 对象，失败返回 None
        """
        if not self.enabled:
            logging.info("摘要功能未启用，跳过")
            return None

        try:
            logging.info(f"开始生成摘要: {metadata.get('filename', 'Unknown')}")

            # 调用 Claude API
            prompt = self._create_prompt(md_content, metadata)
            response = self._call_claude_api(prompt)

            if not response:
                return None

            # 解析响应
            parsed = self._parse_response(response)
            if not parsed:
                return None

            # 提取元数据
            md_metadata = self._extract_metadata_from_md(md_content)

            # 确保 authors 是列表
            authors = parsed.get('authors', [])
            if isinstance(authors, str):
                authors = [authors]
            elif not isinstance(authors, list):
                authors = []

            # 确保其他字段也是列表
            key_findings = parsed.get('key_findings', [])
            if isinstance(key_findings, str):
                key_findings = [key_findings]
            elif not isinstance(key_findings, list):
                key_findings = []

            keywords = parsed.get('keywords', [])
            if isinstance(keywords, str):
                keywords = [keywords]
            elif not isinstance(keywords, list):
                keywords = []

            # 构建摘要对象
            summary = PaperSummary(
                filename=metadata.get('filename', 'Unknown'),
                title=parsed.get('title', ''),
                authors=authors,
                abstract=parsed.get('abstract', ''),
                summary=parsed.get('summary', ''),  # 新增：通俗总结
                key_findings=key_findings,
                keywords=keywords,
                metadata=md_metadata,
                generated_at=datetime.utcnow().isoformat() + 'Z',
                model_used=self.model
            )

            logging.info(f"摘要生成成功: {summary.title[:50] if len(summary.title) > 50 else summary.title}...")
            return summary

        except Exception as e:
            logging.error(f"生成摘要时发生异常: {e}")
            return None

    def save_summary(
        self,
        summary: PaperSummary,
        output_path: str
    ) -> Optional[str]:
        """
        保存摘要到文件

        Args:
            summary: 摘要对象
            output_path: 输出文件路径

        Returns:
            保存的文件路径，失败返回 None
        """
        try:
            # 确保目录存在
            os.makedirs(os.path.dirname(output_path), exist_ok=True)

            with open(output_path, 'w', encoding='utf-8') as f:
                f.write(summary.to_json())

            logging.info(f"摘要已保存: {output_path}")
            return output_path

        except Exception as e:
            logging.error(f"保存摘要失败: {e}")
            return None


# 兼容性别名
Summarizer = AnthropicSummarizer


def main():
    """测试摘要生成器"""
    # 测试 Markdown 内容
    test_md = """
# Deep Learning for Computer Vision: A Comprehensive Survey

**Authors**: Alex Smith, John Doe, Jane Williams

## Abstract

This paper provides a comprehensive survey of deep learning techniques applied to computer vision tasks. We review convolutional neural networks, transformers, and their applications in image classification, object detection, and semantic segmentation. Our analysis covers recent advances in self-supervised learning and multi-modal foundation models.

## 1. Introduction

Computer vision has been revolutionized by deep learning approaches over the past decade...

## 2. Convolutional Neural Networks

CNNs have been the backbone of computer vision systems...

## Key Findings

1. CNNs remain effective for many vision tasks despite the rise of transformers
2. Vision Transformers achieve state-of-the-art results on large-scale datasets
3. Self-supervised learning significantly reduces dependency on labeled data
4. Multi-modal models like CLIP enable zero-shot transfer learning

## Keywords

deep learning, computer vision, CNN, vision transformer, self-supervised learning
"""

    summarizer = AnthropicSummarizer()

    if not summarizer.enabled:
        print("未配置 ANTHROPIC_AUTH_TOKEN，无法测试")
        print("请在 .env 文件中设置:")
        print("  ANTHROPIC_AUTH_TOKEN=your_key_here")
        print("  ANTHROPIC_MODEL=claude-sonnet-4-5-20250929")
        print("  ANTHROPIC_BASE_URL=https://api.anthropic.com  # 可选")
        return

    summary = summarizer.generate_summary(
        test_md,
        {'filename': 'test_paper.pdf'}
    )

    if summary:
        print("\n=== 生成摘要 ===")
        print(summary.to_json())

        # 保存测试文件
        test_output = "/tmp/test_summary.json"
        summarizer.save_summary(summary, test_output)
        print(f"\n摘要已保存到: {test_output}")
    else:
        print("摘要生成失败")


if __name__ == "__main__":
    main()
