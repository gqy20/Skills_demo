#!/usr/bin/env python3
"""
PDF 文本提取脚本
用于 user-profile skill 从 PDF 中提取文本内容

依赖: pip install PyMuPDF
"""

import fitz  # PyMuPDF
import sys
import json


def extract_pdf(file_path: str) -> dict:
    """从 PDF 提取文本和元数据

    Args:
        file_path: PDF 文件路径

    Returns:
        包含 text, pages, metadata 的字典
    """
    # 检查文件扩展名
    if not file_path.lower().endswith('.pdf'):
        return {
            "success": False,
            "error": f"Not a PDF file: {file_path}",
            "text": "",
            "pages": 0,
            "metadata": {}
        }

    try:
        doc = fitz.open(file_path)
        result = {
            "success": True,
            "text": "",
            "pages": len(doc),
            "metadata": {
                "title": doc.metadata.get("title", ""),
                "author": doc.metadata.get("author", ""),
                "subject": doc.metadata.get("subject", ""),
                "keywords": doc.metadata.get("keywords", ""),
            }
        }

        # 逐页提取文本
        for page in doc:
            result["text"] += page.get_text()

        doc.close()
        return result

    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "text": "",
            "pages": 0,
            "metadata": {}
        }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({
            "success": False,
            "error": "Usage: extract_pdf.py <file_path>"
        }, ensure_ascii=False))
        sys.exit(1)

    file_path = sys.argv[1]
    result = extract_pdf(file_path)
    print(json.dumps(result, ensure_ascii=False))
