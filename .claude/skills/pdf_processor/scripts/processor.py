#!/usr/bin/env python3
"""
简化版 PDF 处理器
功能：
1. 扫描并处理 PDF 文件
2. 使用 MinerU API 转换为 Markdown
3. 使用 Claude API 生成摘要
4. 状态跟踪和断点续传
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
from dataclasses import dataclass, asdict
from concurrent.futures import ThreadPoolExecutor, as_completed
import requests
from dotenv import load_dotenv

# 导入摘要生成器
from summarizer import AnthropicSummarizer, PaperSummary

load_dotenv()

@dataclass
class ProcessingResult:
    """处理结果数据类"""
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


class MinerUClient:
    """MinerU API 客户端"""

    def __init__(self, api_key: str):
        self.api_key = api_key
        self.api_base = "https://mineru.net/api/v4"
        self.headers = {'Authorization': f'Bearer {api_key}'}
        self.max_retries = 4
        self.retry_delay = 5
        self.request_timeout = 180

    def test_connection(self) -> bool:
        """测试 API 连接"""
        try:
            url = f"{self.api_base}/file-urls/batch"
            data = {
                "enable_formula": False,
                "language": "ch",
                "enable_table": True,
                "files": [{"name": "test.pdf", "is_ocr": True}]
            }
            response = requests.post(url, headers=self.headers, json=data, timeout=30)
            if response.status_code == 200:
                result = response.json()
                if result.get('code') == 0:
                    logging.info("MinerU API 连接成功")
                    return True
            logging.warning(f"MinerU API 连接测试失败: {response.text[:100]}")
        except Exception as e:
            logging.warning(f"MinerU API 连接测试异常: {e}")
        return False

    def _retry_request(self, func, *args, **kwargs):
        """重试机制"""
        last_error = None
        for attempt in range(self.max_retries):
            try:
                return func(*args, **kwargs)
            except Exception as e:
                last_error = e
                if attempt < self.max_retries - 1:
                    wait = self.retry_delay * (2 ** attempt)
                    time.sleep(wait)
        raise last_error

    def get_upload_url(self, filename: str) -> Dict[str, str]:
        """获取上传链接"""
        def _request():
            url = f"{self.api_base}/file-urls/batch"
            data = {
                "enable_formula": False,
                "language": "ch",
                "enable_table": True,
                "files": [{"name": filename, "is_ocr": True}]
            }
            headers = self.headers.copy()
            headers['Content-Type'] = 'application/json'
            response = requests.post(url, headers=headers, json=data, timeout=self.request_timeout)
            response.raise_for_status()
            result = response.json()
            if result.get('code') != 0:
                raise Exception(f"API 错误: {result.get('msg', 'Unknown')}")
            return {
                'batch_id': result['data']['batch_id'],
                'file_url': result['data']['file_urls'][0]
            }
        return self._retry_request(_request)

    def upload_file(self, file_path: Path, upload_url: str) -> bool:
        """上传文件"""
        def _upload():
            with open(file_path, 'rb') as f:
                response = requests.put(upload_url, data=f, timeout=self.request_timeout)
                response.raise_for_status()
            return True
        return self._retry_request(_upload)

    def get_batch_result(self, batch_id: str) -> Optional[Dict]:
        """获取批量任务结果"""
        def _request():
            url = f"{self.api_base}/extract-results/batch/{batch_id}"
            response = requests.get(url, headers=self.headers, timeout=self.request_timeout)
            response.raise_for_status()
            result = response.json()
            if result.get('code') != 0:
                raise Exception(f"获取结果失败: {result.get('msg')}")
            return result['data']
        return self._retry_request(_request)

    def wait_for_completion(self, batch_id: str, max_wait: int = 300) -> Optional[str]:
        """等待处理完成"""
        start = time.time()
        while time.time() - start < max_wait:
            try:
                result = self.get_batch_result(batch_id)
                if result and result.get('extract_result'):
                    extract_result = result['extract_result'][0]
                    state = extract_result.get('state')
                    if state == 'done':
                        return extract_result.get('full_zip_url')
                    elif state == 'failed':
                        raise Exception(f"处理失败: {extract_result.get('err_msg', 'Unknown')}")
                    elif state in ['pending', 'running', 'converting']:
                        logging.info(f"处理状态: {state}")
            except Exception as e:
                if "处理失败" in str(e):
                    raise
                logging.warning(f"检查状态失败: {e}")
            time.sleep(10)
        raise Exception(f"处理超时（{max_wait}秒）")

    def download_result(self, download_url: str, output_dir: Path, pdf_name: str) -> Tuple[bool, str, str]:
        """下载处理结果"""
        def _download():
            response = requests.get(download_url, timeout=300)
            response.raise_for_status()

            with tempfile.TemporaryDirectory() as temp_dir:
                with zipfile.ZipFile(io.BytesIO(response.content)) as zip_file:
                    zip_file.extractall(temp_dir)

                # 查找 markdown 文件
                md_files = []
                for root, dirs, files in os.walk(temp_dir):
                    for f in files:
                        if f.endswith('.md'):
                            md_files.append(os.path.join(root, f))

                if not md_files:
                    raise Exception("ZIP 中未找到 Markdown 文件")

                # 创建输出目录
                md_dir = output_dir / "md"
                md_dir.mkdir(parents=True, exist_ok=True)

                # 复制 markdown
                pdf_stem = Path(pdf_name).stem
                dst_md = md_dir / f"{pdf_stem}.md"

                with open(md_files[0], 'r', encoding='utf-8') as f:
                    content = f.read()
                with open(dst_md, 'w', encoding='utf-8') as f:
                    f.write(content)

                logging.info(f"Markdown 已保存: {dst_md}")

                # 复制图片
                images_dst = output_dir / "imgs" / pdf_stem
                images_src = None
                for root, dirs, files in os.walk(temp_dir):
                    if 'images' in dirs:
                        images_src = os.path.join(root, 'images')
                        break

                image_count = 0
                if images_src and os.path.exists(images_src):
                    images_dst.mkdir(parents=True, exist_ok=True)
                    for f in os.listdir(images_src):
                        src = os.path.join(images_src, f)
                        dst = images_dst / f
                        if os.path.isfile(src):
                            with open(src, 'rb') as sf:
                                with open(dst, 'wb') as df:
                                    df.write(sf.read())
                            image_count += 1
                    if image_count > 0:
                        logging.info(f"提取 {image_count} 个图片")

                return True, str(dst_md), str(images_dst)

        try:
            return self._retry_request(_download)
        except Exception as e:
            logging.error(f"下载结果失败: {e}")
            return False, "", ""

    def convert_pdf(self, pdf_path: Path, output_dir: Path) -> Tuple[bool, str, str]:
        """转换 PDF"""
        try:
            logging.info(f"开始处理: {pdf_path.name}")

            if not pdf_path.exists():
                raise FileNotFoundError(f"文件不存在: {pdf_path}")

            size_mb = pdf_path.stat().st_size / (1024 * 1024)
            logging.info(f"文件大小: {size_mb:.2f} MB")

            # 获取上传链接
            upload_info = self.get_upload_url(pdf_path.name)
            batch_id = upload_info['batch_id']
            upload_url = upload_info['file_url']

            # 上传文件
            logging.info("上传文件中...")
            self.upload_file(pdf_path, upload_url)

            # 等待处理
            logging.info("等待处理完成...")
            download_url = self.wait_for_completion(batch_id)

            if not download_url:
                raise Exception("处理失败")

            # 下载结果
            logging.info("下载结果中...")
            return self.download_result(download_url, output_dir, pdf_path.name)

        except Exception as e:
            logging.error(f"转换失败: {e}")
            return False, "", ""


class PDFProcessor:
    """PDF 处理器（简化版，支持并行处理）"""

    def __init__(self, config: Dict):
        self.config = config
        self.pdf_dir = Path(config.get('pdf_dir', '01_articles'))
        self.output_dir = Path(config.get('output_dir', '01_articles/processed'))
        self.status_file = Path(config.get('status_file', '.info/.pdf_processing_status.csv'))

        # 并行处理配置
        self.max_workers = config.get('max_workers', 5)  # 默认5个并发
        self.enable_parallel = config.get('enable_parallel', True)

        # 初始化客户端
        api_key = config.get('mineru_api_key')
        self.mineru = MinerUClient(api_key) if api_key else None
        self.summarizer = AnthropicSummarizer()

        # 加载状态
        self.processing_status = self.load_status()

        # 线程锁（用于保护状态保存）
        self._status_lock = threading.Lock()
        self._print_lock = threading.Lock()

        # 设置日志
        self.setup_logging()

    def setup_logging(self):
        """设置日志"""
        log_file = self.config.get('log_file', '01_articles/pdf_processing.log')
        log_dir = Path(log_file).parent
        log_dir.mkdir(parents=True, exist_ok=True)

        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(levelname)s - %(message)s',
            handlers=[
                logging.FileHandler(log_file),
                logging.StreamHandler()
            ]
        )

    def load_status(self) -> Dict[str, Dict]:
        """加载处理状态"""
        if self.status_file.exists():
            try:
                status = {}
                with open(self.status_file, 'r', encoding='utf-8') as f:
                    reader = csv.DictReader(f)
                    for row in reader:
                        filename = row.pop('filename', None)
                        if filename:
                            # 转换数据类型
                            for k, v in row.items():
                                if k in ['md_converted', 'summary_generated', 'md_file_reused']:
                                    row[k] = v.lower() == 'true' if v else False
                                elif k == 'error_message' and v == '':
                                    row[k] = None
                            status[filename] = row
                return status
            except Exception as e:
                logging.warning(f"加载状态失败: {e}")
        return {}

    def save_status(self):
        """保存处理状态（线程安全）"""
        with self._status_lock:
            try:
                self.status_file.parent.mkdir(parents=True, exist_ok=True)

                fieldnames = [
                    'filename', 'md_converted', 'summary_generated', 'md_path',
                    'images_dir', 'summary_path', 'error_message',
                    'processing_time', 'md_file_reused'
                ]

                with open(self.status_file, 'w', encoding='utf-8', newline='') as f:
                    writer = csv.DictWriter(f, fieldnames=fieldnames)
                    writer.writeheader()

                    for filename, status in self.processing_status.items():
                        row = {'filename': filename}
                        row.update(status)
                        writer.writerow(row)

            except Exception as e:
                logging.error(f"保存状态失败: {e}")

    def get_expected_md_path(self, pdf_name: str) -> Path:
        """获取预期的 MD 文件路径"""
        return self.output_dir / "md" / f"{Path(pdf_name).stem}.md"

    def get_expected_summary_path(self, pdf_name: str) -> Path:
        """获取预期的摘要文件路径"""
        return self.output_dir / "summaries" / f"{Path(pdf_name).stem}.json"

    def is_md_file_valid(self, pdf_path: Path) -> Tuple[bool, str]:
        """检查 MD 文件是否有效"""
        md_path = self.get_expected_md_path(pdf_path.name)

        if not md_path.exists():
            return False, "MD 文件不存在"

        if md_path.stat().st_size < 100:
            return False, "MD 文件过小"

        pdf_mtime = pdf_path.stat().st_mtime
        md_mtime = md_path.stat().st_mtime
        if md_mtime < pdf_mtime:
            return False, "MD 文件比 PDF 旧"

        try:
            with open(md_path, 'r', encoding='utf-8') as f:
                content = f.read()
                if len(content.strip()) < 50:
                    return False, "MD 内容过少"
                markdown_indicators = ['#', '##', '**', '![', '|']
                if not any(ind in content for ind in markdown_indicators):
                    return False, "缺少有效内容"
        except Exception as e:
            return False, f"读取失败: {e}"

        return True, "MD 文件有效"

    def is_summary_valid(self, pdf_path: Path) -> Tuple[bool, str]:
        """检查摘要是否有效"""
        summary_path = self.get_expected_summary_path(pdf_path.name)

        if not summary_path.exists():
            return False, "摘要不存在"

        # 检查是否比 MD 文件新
        md_path = self.get_expected_md_path(pdf_path.name)
        if md_path.exists():
            md_mtime = md_path.stat().st_mtime
            summary_mtime = summary_path.stat().st_mtime
            if summary_mtime < md_mtime:
                return False, "摘要比 MD 文件旧"

        return True, "摘要有效"

    def process_single_pdf(self, pdf_path: Path) -> ProcessingResult:
        """处理单个 PDF"""
        start = time.time()
        result = ProcessingResult(filename=pdf_path.name)

        try:
            logging.info(f"开始处理: {pdf_path.name}")

            # 1. 检查 MD 文件
            md_valid, md_msg = self.is_md_file_valid(pdf_path)
            md_path = self.get_expected_md_path(pdf_path.name)

            if md_valid:
                logging.info(f"重用现有 MD: {md_msg}")
                result.md_converted = True
                result.md_path = str(md_path)
                result.md_file_reused = True

                # 检查是否需要重新生成摘要
                summary_valid, _ = self.is_summary_valid(pdf_path)
                if summary_valid and self.summarizer.enabled:
                    result.summary_generated = True
                    result.summary_path = str(self.get_expected_summary_path(pdf_path.name))
            else:
                # 2. 转换 PDF
                if self.mineru and self.mineru.test_connection():
                    logging.info("转换 PDF 中...")
                    success, md_p, imgs_dir = self.mineru.convert_pdf(pdf_path, self.output_dir)
                    result.md_converted = success
                    result.md_path = md_p if success else None
                    result.images_dir = imgs_dir if success else None

                    if not success:
                        result.error_message = "PDF 转换失败"
                else:
                    result.error_message = "MinerU API 不可用"
                    logging.warning(result.error_message)

            # 3. 生成摘要（如果需要）
            if result.md_converted and not result.summary_generated and self.summarizer.enabled:
                try:
                    with open(md_path, 'r', encoding='utf-8') as f:
                        md_content = f.read()

                    summary = self.summarizer.generate_summary(
                        md_content,
                        {'filename': pdf_path.name}
                    )

                    if summary:
                        summary_path = str(self.get_expected_summary_path(pdf_path.name))
                        saved_path = self.summarizer.save_summary(summary, summary_path)
                        if saved_path:
                            result.summary_generated = True
                            result.summary_path = saved_path
                except Exception as e:
                    logging.warning(f"摘要生成失败: {e}")

        except Exception as e:
            result.error_message = str(e)
            logging.error(f"处理异常: {e}")

        finally:
            result.processing_time = time.time() - start

            # 保存状态
            self.processing_status[pdf_path.name] = result.to_dict()
            self.save_status()

        return result

    def process_all_pdfs(self) -> List[ProcessingResult]:
        """处理所有 PDF（支持并行处理）"""
        if not self.pdf_dir.exists():
            logging.error(f"PDF 目录不存在: {self.pdf_dir}")
            return []

        pdf_files = list(self.pdf_dir.glob("*.pdf"))
        total_files = len(pdf_files)

        if total_files == 0:
            logging.info("没有找到 PDF 文件")
            return []

        logging.info(f"找到 {total_files} 个 PDF 文件")

        # 根据配置选择串行或并行处理
        if self.enable_parallel and total_files > 1:
            return self._process_parallel(pdf_files)
        else:
            return self._process_sequential(pdf_files)

    def _process_sequential(self, pdf_files: List[Path]) -> List[ProcessingResult]:
        """串行处理 PDF"""
        results = []
        for pdf_path in pdf_files:
            result = self.process_single_pdf(pdf_path)
            results.append(result)
            self._print_result(result, pdf_path.name)
        return results

    def _process_parallel(self, pdf_files: List[Path]) -> List[ProcessingResult]:
        """并行处理 PDF"""
        results = []
        completed_count = 0
        total_count = len(pdf_files)

        logging.info(f"使用并行处理模式 (并发数: {self.max_workers})")

        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            # 提交所有任务
            future_to_pdf = {
                executor.submit(self.process_single_pdf, pdf_path): pdf_path
                for pdf_path in pdf_files
            }

            # 处理完成的任务
            for future in as_completed(future_to_pdf):
                pdf_path = future_to_pdf[future]
                try:
                    result = future.result()
                    results.append(result)
                    completed_count += 1

                    # 打印进度
                    self._print_result(result, pdf_path.name, completed_count, total_count)

                except Exception as e:
                    logging.error(f"处理 {pdf_path.name} 时发生异常: {e}")
                    # 创建失败结果
                    error_result = ProcessingResult(filename=pdf_path.name)
                    error_result.error_message = str(e)
                    results.append(error_result)
                    self._print_result(error_result, pdf_path.name, completed_count, total_count)

        # 按文件名排序，保持一致顺序
        results.sort(key=lambda r: r.filename)
        return results

    def _print_result(self, result: ProcessingResult, filename: str,
                     current: int = None, total: int = None):
        """打印处理结果（线程安全）"""
        with self._print_lock:
            status = "✅" if result.md_converted else "❌"
            summary_mark = " 📝" if result.summary_generated else ""
            reused = " (重用)" if result.md_file_reused else ""

            progress = f"[{current}/{total}] " if current and total else ""
            print(f"{progress}{status} {filename}{reused}{summary_mark} ({result.processing_time:.1f}s)")

            if result.error_message:
                print(f"   ⚠️  {result.error_message}")

    def generate_report(self, results: List[ProcessingResult]):
        """生成处理报告"""
        total = len(results)
        if total == 0:
            print("\n没有 PDF 文件需要处理")
            return

        md_converted = sum(1 for r in results if r.md_converted)
        summary_generated = sum(1 for r in results if r.summary_generated)
        md_reused = sum(1 for r in results if r.md_file_reused)
        newly_converted = md_converted - md_reused

        report = f"""
╔═════════════════════════════════════════════╗
║           PDF 处理报告                        ║
╚═════════════════════════════════════════════╝

📊 统计信息
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
总文件数:        {total}
MD 转换成功:     {md_converted} ({md_converted/total*100:.1f}%)
  - 新转换:       {newly_converted}
  - 重用现有:     {md_reused}
摘要生成成功:    {summary_generated}

📁 处理结果
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MD 目录:   {self.output_dir}/md/
摘要目录: {self.output_dir}/summaries/

📄 文件详情
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""

        for r in results:
            status = "✅" if r.md_converted else "❌"
            summary_info = " + 📝" if r.summary_generated else ""
            reused = " (重用)" if r.md_file_reused else ""
            report += f"{status} {r.filename}{reused}{summary_info}\n"

        print(report)


def main():
    """主函数"""
    config = {
        'pdf_dir': os.getenv('PDF_DIR', '01_articles'),
        'output_dir': os.getenv('OUTPUT_DIR', '01_articles/processed'),
        'status_file': os.getenv('STATUS_FILE', '.info/.pdf_processing_status.csv'),
        'log_file': os.getenv('LOG_FILE', '01_articles/pdf_processing.log'),
        'mineru_api_key': os.getenv('MINERU_API_KEY'),
        # 并行处理配置
        'max_workers': int(os.getenv('PDF_MAX_WORKERS', '5')),
        'enable_parallel': os.getenv('PDF_ENABLE_PARALLEL', 'true').lower() == 'true',
    }

    print(f"📁 PDF 目录: {config['pdf_dir']}")
    print(f"🔄 并行处理: {'启用 (并发数: {})'.format(config['max_workers']) if config['enable_parallel'] else '禁用'}")
    print()

    processor = PDFProcessor(config)
    results = processor.process_all_pdfs()
    processor.generate_report(results)


if __name__ == "__main__":
    main()
