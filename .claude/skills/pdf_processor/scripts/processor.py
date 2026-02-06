#!/usr/bin/env python3
"""
PDF 处理器 - 简化版

功能：
1. 扫描 PDF 文件
2. 使用 MinerU API 转换为 Markdown
3. 状态跟踪（摘要由 Claude Code 直接生成）
4. 断点续传
"""

import os
import csv
import json
import time
import logging
import io
import tempfile
import zipfile
import threading
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass
from concurrent.futures import ThreadPoolExecutor, as_completed
import requests
from dotenv import load_dotenv

# 明确指定 .env 文件路径
dotenv_path = Path('/workspaces/Skills_demo/.env')
load_dotenv(dotenv_path=str(dotenv_path))

logger = logging.getLogger(__name__)


# =============================================================================
# 处理状态
# =============================================================================

@dataclass
class ProcessingResult:
    """处理结果"""
    filename: str
    md_converted: bool = False
    summary_generated: bool = False
    md_path: Optional[str] = None
    images_dir: Optional[str] = None
    summary_path: Optional[str] = None
    error_message: Optional[str] = None
    processing_time: float = 0.0
    md_file_reused: bool = False

    def to_dict(self) -> Dict:
        return {
            'filename': self.filename,
            'md_converted': self.md_converted,
            'summary_generated': self.summary_generated,
            'md_path': self.md_path,
            'images_dir': self.images_dir,
            'summary_path': self.summary_path,
            'error_message': self.error_message,
            'processing_time': self.processing_time,
            'md_file_reused': self.md_file_reused
        }


# =============================================================================
# MinerU 客户端 - 参考 pdf_to_bib_processor.py 的实现
# =============================================================================

class MinerUClient:
    """基于官方实现的 MinerU API 客户端"""

    def __init__(self, api_key: str):
        """初始化客户端"""
        self.api_key = api_key
        self.api_base = "https://mineru.net/api/v4"
        self.headers = {
            'Authorization': f'Bearer {api_key}'
        }
        self.max_retries = 4
        self.retry_delay = 5
        self.request_timeout = 180

    def test_connection(self, force: bool = False) -> bool:
        """测试 API 连接"""
        # 每次都重新测试，因为 API key 可能已更新
        # 移除缓存以确保使用最新的凭据

        print("🔗 测试 MinerU API 连接...")

        # 尝试获取上传链接来测试认证
        test_data = {
            "enable_formula": False,
            "language": "ch",
            "enable_table": True,
            "files": [{"name": "test.pdf", "is_ocr": True}]
        }

        try:
            url = f"{self.api_base}/file-urls/batch"
            headers = self.headers.copy()
            headers['Content-Type'] = 'application/json'

            response = requests.post(url, headers=headers, json=test_data, timeout=30)

            if response.status_code == 200:
                result = response.json()
                if result.get('code') == 0:
                    print("✅ MinerU API 连接成功！")
                    return True
                else:
                    print(f"❌ API 返回错误: {result.get('msg', 'Unknown error')}")
            elif response.status_code == 401:
                print("❌ 401 认证失败 - API 密钥无效或已过期")
            else:
                print(f"❌ HTTP 错误: {response.status_code}")

        except Exception as e:
            print(f"❌ 连接异常: {e}")

        print("💡 建议：访问 https://mineru.net/apiManage 检查 API 密钥")
        return False

    def _get_upload_url(self, filename: str, **kwargs) -> Dict[str, str]:
        """获取文件上传链接"""
        url = f"{self.api_base}/file-urls/batch"
        data = {
            "enable_formula": kwargs.get('enable_formula', False),
            "language": kwargs.get('language', 'ch'),
            "enable_table": kwargs.get('enable_table', True),
            "files": [{"name": filename, "is_ocr": kwargs.get('is_ocr', True)}]
        }

        headers = self.headers.copy()
        headers['Content-Type'] = 'application/json'

        response = requests.post(url, headers=headers, json=data, timeout=self.request_timeout)
        response.raise_for_status()

        result = response.json()
        if result.get('code') != 0:
            raise Exception(f"API 返回错误: {result.get('msg', 'Unknown error')}")

        batch_id = result['data']['batch_id']
        file_url = result['data']['file_urls'][0]
        logger.info(f"获取上传链接成功，批次ID: {batch_id}")
        return {'batch_id': batch_id, 'file_url': file_url}

    def _upload_file_to_url(self, file_path: Path, upload_url: str) -> bool:
        """将文件上传到指定 URL"""
        with open(file_path, 'rb') as f:
            response = requests.put(upload_url, data=f, timeout=self.request_timeout)
            response.raise_for_status()
            logger.info(f"文件 {file_path.name} 上传成功")
            return True

    def get_batch_result(self, batch_id: str) -> Optional[Dict]:
        """获取批量任务结果"""
        url = f"{self.api_base}/extract-results/batch/{batch_id}"
        response = requests.get(url, headers=self.headers, timeout=self.request_timeout)
        response.raise_for_status()

        result = response.json()
        if result.get('code') != 0:
            raise Exception(f"获取批量结果失败: {result.get('msg', 'Unknown error')}")

        return result['data']

    def wait_for_completion(self, batch_id: str, max_wait_time: int = 300) -> Optional[str]:
        """等待批量任务完成并返回结果 URL"""
        start_time = time.time()
        check_interval = 10
        last_status_log_time = 0

        logger.info(f"开始等待 MinerU API 处理文件，批次ID: {batch_id}")

        while time.time() - start_time < max_wait_time:
            try:
                result = self.get_batch_result(batch_id)
                if result and result.get('extract_result'):
                    extract_result = result['extract_result'][0]
                    state = extract_result.get('state')
                    current_time = time.time()

                    if state == 'done':
                        logger.info("🎉 PDF 处理完成！")
                        return extract_result.get('full_zip_url')
                    elif state == 'failed':
                        error_msg = extract_result.get('err_msg', 'Unknown error')
                        logger.error(f"❌ PDF 处理失败: {error_msg}")
                        raise Exception(f"PDF 处理失败: {error_msg}")
                    elif state in ['pending', 'running', 'converting']:
                        if current_time - last_status_log_time >= 30:
                            elapsed_time = int(current_time - start_time)
                            logger.info(f"⏳ PDF 处理状态: {state} (已等待 {elapsed_time}s)")
                            last_status_log_time = current_time
                    else:
                        logger.warning(f"⚠️ 未知的处理状态: {state}")

            except Exception as e:
                if "PDF 处理失败" in str(e):
                    raise
                logger.warning(f"检查处理状态时出错: {e}，将重试...")

            time.sleep(check_interval)

        elapsed_minutes = int((time.time() - start_time) / 60)
        logger.error(f"❌ PDF 处理超时！已等待 {elapsed_minutes} 分钟")
        raise Exception(f"PDF 处理超时，已等待 {elapsed_minutes} 分钟")

    def download_result(self, download_url: str, output_dir: Path, pdf_name: str) -> Tuple[bool, str, str]:
        """下载解析结果"""
        response = requests.get(download_url, timeout=300)
        response.raise_for_status()

        with tempfile.TemporaryDirectory() as temp_dir:
            with zipfile.ZipFile(io.BytesIO(response.content)) as zip_file:
                zip_file.extractall(temp_dir)

                # 查找 markdown 文件
                md_files = []
                for root, dirs, files in os.walk(temp_dir):
                    for file in files:
                        if file.endswith('.md'):
                            md_files.append(os.path.join(root, file))

                if not md_files:
                    raise Exception("ZIP 文件中未找到 Markdown 文件")

                # 创建输出目录
                md_output_dir = output_dir / "md"
                md_output_dir.mkdir(parents=True, exist_ok=True)

                # 复制第一个 markdown 文件
                src_md = md_files[0]
                pdf_stem = Path(pdf_name).stem
                dst_md = md_output_dir / f"{pdf_stem}.md"

                with open(src_md, 'r', encoding='utf-8') as f:
                    content = f.read()
                with open(dst_md, 'w', encoding='utf-8') as f:
                    f.write(content)

                logger.info(f"Markdown 文件已保存到: {dst_md}")

                # 复制 images 文件夹
                images_dst = output_dir / "imgs" / pdf_stem
                images_src = None
                images_count = 0

                # 查找 images 目录
                for root, dirs, files in os.walk(temp_dir):
                    if 'images' in dirs:
                        images_src = os.path.join(root, 'images')
                        logger.info(f"找到 images 目录: {images_src}")
                        break

                if images_src and os.path.exists(images_src):
                    images_dst.mkdir(parents=True, exist_ok=True)
                    image_files = os.listdir(images_src)
                    logger.info(f"图片文件数: {len(image_files)}")

                    for file in image_files:
                        src_file = os.path.join(images_src, file)
                        dst_file = images_dst / file
                        if os.path.isfile(src_file):
                            with open(src_file, 'rb') as f:
                                content = f.read()
                            with open(dst_file, 'wb') as f:
                                f.write(content)
                            images_count += 1

                    logger.info(f"已提取 {images_count} 个图片文件到: {images_dst}")
                else:
                    logger.warning("未找到 images 目录")

                images_dst_str = str(images_dst) if images_count > 0 else ""
                return True, str(dst_md), images_dst_str

        return False, "", ""

    def convert(self, pdf_path: str, output_dir: Path = None) -> Tuple[bool, str, str]:
        """转换 PDF 到 Markdown（完整流程，返回 MD 路径和图片路径）"""
        pdf_file = Path(pdf_path)
        # 使用传入的 output_dir，如果未传入则使用 PDF 父目录的 processed
        if output_dir is None:
            output_dir = pdf_file.parent / "processed"
        else:
            output_dir = Path(output_dir)

        try:
            logger.info(f"开始处理 PDF 文件: {pdf_file}")

            if not pdf_file.exists():
                raise FileNotFoundError(f"文件不存在: {pdf_file}")

            file_size_mb = pdf_file.stat().st_size / (1024 * 1024)
            logger.info(f"文件大小: {file_size_mb:.2f} MB")

            # 1. 获取上传链接
            logger.info("正在获取上传链接...")
            upload_info = self._get_upload_url(pdf_file.name)
            batch_id = upload_info['batch_id']
            upload_url = upload_info['file_url']

            # 2. 上传文件
            logger.info("正在上传文件...")
            self._upload_file_to_url(pdf_file, upload_url)

            # 3. 等待处理完成
            logger.info("正在等待处理完成...")
            download_url = self.wait_for_completion(batch_id, 300)

            if not download_url:
                raise Exception("处理失败或超时")

            # 4. 下载结果
            logger.info("正在下载结果...")
            success, md_path, images_dir = self.download_result(download_url, output_dir, pdf_file.name)

            if success:
                logger.info(f"✅ PDF 处理完成！结果已保存到: {md_path}")
                if images_dir:
                    logger.info(f"📁 图片已保存到: {images_dir}")
                return success, md_path, images_dir
            return False, "", ""

        except Exception as e:
            logger.error(f"MinerU 转换异常: {e}")
            return False, "", ""


# =============================================================================
# PDF 处理器
# =============================================================================

class PDFProcessor:
    """PDF 处理器"""

    def __init__(self, config: Dict):
        self.pdf_dir = Path(config.get('pdf_dir', '01_articles'))
        self.output_dir = Path(config.get('output_dir', '01_articles/processed'))
        self.status_file = Path(config.get('status_file', '.info/.pdf_processing_status.csv'))

        api_key = config.get('mineru_api_key', os.getenv('MINERU_API_KEY'))
        self.mineru_client = MinerUClient(api_key)

        self.status: Dict[str, Dict] = {}
        self._print_lock = threading.Lock()

        self.max_workers = int(config.get('max_workers', 5))
        self.enable_parallel = config.get('enable_parallel', True)

        self._load_status()

    def _load_status(self):
        """加载处理状态"""
        if self.status_file.exists():
            with open(self.status_file, 'r', encoding='utf-8') as f:
                reader = csv.DictReader(f)
                for row in reader:
                    self.status[row['filename']] = row

    def _save_status(self):
        """保存处理状态"""
        with open(self.status_file, 'w', encoding='utf-8', newline='') as f:
            if self.status:
                fieldnames = list(list(self.status.values())[0].keys())
                writer = csv.DictWriter(f, fieldnames=fieldnames)
                writer.writeheader()
                writer.writerows(self.status.values())

    def get_expected_md_path(self, filename: str) -> Path:
        return self.output_dir / 'md' / f"{Path(filename).stem}.md"

    def get_expected_summary_path(self, filename: str) -> Path:
        return self.output_dir / 'summaries' / f"{Path(filename).stem}.json"

    def is_md_file_valid(self, pdf_path: Path) -> Tuple[bool, str]:
        """检查 MD 文件是否存在且有效"""
        md_path = self.get_expected_md_path(pdf_path.name)

        if not md_path.exists():
            return False, "MD 文件不存在"

        if md_path.stat().st_size < 100:
            return False, "MD 文件过小"

        try:
            with open(md_path, 'r', encoding='utf-8') as f:
                content = f.read()
                if len(content.strip()) < 50:
                    return False, "MD 文件内容过少"
        except Exception as e:
            return False, f"读取 MD 文件失败: {e}"

        return True, "MD 文件有效"

    def get_expected_images_dir(self, filename: str) -> Path:
        """获取预期的图片目录"""
        return self.output_dir / 'imgs' / Path(filename).stem

    def process_single_pdf(self, pdf_path: Path) -> ProcessingResult:
        """处理单个 PDF"""
        result = ProcessingResult(filename=pdf_path.name)
        start = time.time()

        try:
            md_path = self.get_expected_md_path(pdf_path.name)
            summary_path = self.get_expected_summary_path(pdf_path.name)

            # 1. 检查是否已有有效的 MD 文件
            md_valid, md_message = self.is_md_file_valid(pdf_path)
            if md_valid:
                result.md_converted = True
                result.md_file_reused = True
                result.md_path = str(md_path)
                # 检查图片目录
                images_dir = self.output_dir / 'imgs' / pdf_path.stem
                if images_dir.exists():
                    result.images_dir = str(images_dir)
                logger.info(f"重用现有 MD: {pdf_path.name}")
            else:
                # 2. 测试连接并转换
                if self.mineru_client.test_connection():
                    logger.info(f"MD 文件无效: {md_message}，开始转换...")
                    # download_result 已在磁盘写入文件，返回的是 md_path 和 images_dir
                    success, md_path, images_dir = self.mineru_client.convert(str(pdf_path), self.output_dir)
                    if success:
                        # MD 文件已由 download_result 保存，无需再次写入
                        result.md_converted = True
                        result.md_path = str(md_path)
                        result.images_dir = images_dir if images_dir else None
                        logger.info(f"MD 转换成功: {pdf_path.name}")
                        logger.info(f"MD 文件路径: {md_path}")
                        if images_dir:
                            logger.info(f"图片目录: {images_dir}")
                    else:
                        result.error_message = "Markdown 转换失败"
                        return result
                else:
                    result.error_message = "MinerU API 连接失败"
                    return result

            # 3. 检查摘要状态
            result.summary_generated = summary_path.exists()
            result.summary_path = str(summary_path)

        except Exception as e:
            result.error_message = str(e)
            logger.error(f"处理异常: {e}")

        finally:
            result.processing_time = time.time() - start
            self.status[pdf_path.name] = result.to_dict()
            self._save_status()

        return result

    def process_all_pdfs(self) -> List[ProcessingResult]:
        """处理所有 PDF"""
        if not self.pdf_dir.exists():
            logger.error(f"PDF 目录不存在: {self.pdf_dir}")
            return []

        pdf_files = list(self.pdf_dir.glob("*.pdf"))
        if not pdf_files:
            logger.info("没有找到 PDF 文件")
            return []

        if self.enable_parallel and len(pdf_files) > 1:
            return self._process_parallel(pdf_files)
        return self._process_sequential(pdf_files)

    def _process_sequential(self, pdf_files: List[Path]) -> List[ProcessingResult]:
        """串行处理"""
        results = []
        for pdf_path in pdf_files:
            result = self.process_single_pdf(pdf_path)
            results.append(result)
            self._print_result(result)
        return results

    def _process_parallel(self, pdf_files: List[Path]) -> List[ProcessingResult]:
        """并行处理"""
        results = []
        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            futures = {executor.submit(self.process_single_pdf, p): p for p in pdf_files}
            for future in as_completed(futures):
                result = future.result()
                results.append(result)
                self._print_result(result)
        return sorted(results, key=lambda r: r.filename)

    def _print_result(self, result: ProcessingResult):
        """打印结果"""
        with self._print_lock:
            status = "✅" if result.md_converted else "❌"
            summary_mark = " 📝" if result.summary_generated else ""
            reused = " (重用)" if result.md_file_reused else ""
            images_mark = f" 🖼️" if result.images_dir else ""
            error_msg = f" [{result.error_message}]" if result.error_message else ""
            print(f"{status} {result.filename}{reused}{summary_mark}{images_mark}{error_msg} ({result.processing_time:.1f}s)")

    def generate_report(self, results: List[ProcessingResult]):
        """生成报告"""
        if not results:
            print("\n没有 PDF 文件需要处理")
            return

        total = len(results)
        md_converted = sum(1 for r in results if r.md_converted)
        summary_generated = sum(1 for r in results if r.summary_generated)
        images_extracted = sum(1 for r in results if r.images_dir)

        print(f"""
╔═════════════════════════════════════════════╗
║           PDF 处理报告                        ║
╚═════════════════════════════════════════════╝

📊 统计信息
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
总文件数:        {total}
MD 转换成功:     {md_converted} ({md_converted/total*100:.1f}%)
摘要生成成功:    {summary_generated}
图片提取成功:    {images_extracted}

📁 处理结果
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MD 目录:   {self.output_dir}/md/
图片目录: {self.output_dir}/imgs/
摘要目录: {self.output_dir}/summaries/

📄 文件详情
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━""")

        for r in results:
            status = "✅" if r.md_converted else "❌"
            summary = " + 📝" if r.summary_generated else ""
            reused = " (重用)" if r.md_file_reused else ""
            images = f" 🖼️" if r.images_dir else ""
            error = f" [{r.error_message}]" if r.error_message else ""
            print(f"{status} {r.filename}{reused}{summary}{images}{error}")


def main():
    """主函数"""
    config = {
        'pdf_dir': os.getenv('PDF_DIR', '01_articles'),
        'output_dir': os.getenv('OUTPUT_DIR', '01_articles/processed'),
        'status_file': os.getenv('STATUS_FILE', '.info/.pdf_processing_status.csv'),
        'mineru_api_key': os.getenv('MINERU_API_KEY'),
        'max_workers': int(os.getenv('PDF_MAX_WORKERS', '5')),
        'enable_parallel': os.getenv('PDF_ENABLE_PARALLEL', 'true').lower() == 'true',
    }

    print(f"📁 PDF 目录: {config['pdf_dir']}")
    print(f"🔄 并行处理: {'启用' if config['enable_parallel'] else '禁用'}")
    print()

    processor = PDFProcessor(config)
    results = processor.process_all_pdfs()
    processor.generate_report(results)


if __name__ == "__main__":
    main()
