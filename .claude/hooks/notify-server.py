#!/usr/bin/env python3
"""
Claude Code 浏览器通知服务器
在 Codespace 中运行，通过端口转发提供浏览器通知
"""

import os
import json
import time
from datetime import datetime
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

# 配置
NOTIFY_FILE = Path(__file__).parent.parent.parent / ".info" / ".last_complete"
PORT = 8888

class NotifyHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/notify' or self.path == '/':
            # 返回通知页面
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.end_headers()

            html = f'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Claude Code 通知</title>
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            color: #eee;
        }}
        .container {{
            text-align: center;
            padding: 2rem;
        }}
        .status {{
            font-size: 1.2rem;
            margin-bottom: 1rem;
            opacity: 0.8;
        }}
        .notification {{
            background: linear-gradient(135deg, #00d2ff 0%, #3a7bd5 100%);
            padding: 2rem 3rem;
            border-radius: 1rem;
            box-shadow: 0 20px 60px rgba(0, 150, 255, 0.3);
            margin: 2rem 0;
            transform: scale(0.9);
            opacity: 0;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }}
        .notification.show {{
            transform: scale(1);
            opacity: 1;
        }}
        .notification-icon {{
            font-size: 3rem;
            margin-bottom: 0.5rem;
        }}
        .notification-title {{
            font-size: 1.5rem;
            font-weight: bold;
            margin-bottom: 0.5rem;
        }}
        .notification-time {{
            font-size: 0.9rem;
            opacity: 0.8;
        }}
        .pulse {{
            animation: pulse 2s infinite;
        }}
        @keyframes pulse {{
            0%, 100% {{ opacity: 1; }}
            50% {{ opacity: 0.5; }}
        }}
        .controls {{
            margin-top: 2rem;
            display: flex;
            gap: 1rem;
        }}
        button {{
            background: rgba(255, 255, 255, 0.1);
            border: 1px solid rgba(255, 255, 255, 0.2);
            color: #fff;
            padding: 0.8rem 1.5rem;
            border-radius: 0.5rem;
            cursor: pointer;
            transition: all 0.3s;
            font-size: 0.9rem;
        }}
        button:hover {{
            background: rgba(255, 255, 255, 0.2);
            transform: translateY(-2px);
        }}
        button:active {{
            transform: translateY(0);
        }}
        .hidden {{ display: none; }}
    </style>
</head>
<body>
    <div class="container">
        <div class="status pulse" id="status">
            🔔 等待 Claude 完成响应...
        </div>

        <div class="notification" id="notification">
            <div class="notification-icon">✓</div>
            <div class="notification-title">Claude 响应完成</div>
            <div class="notification-time" id="notifyTime">--:--:--</div>
        </div>

        <div class="controls">
            <button onclick="requestPermission()">🔔 启用浏览器通知</button>
            <button onclick="testNotification()">🧪 测试通知</button>
            <button onclick="clearNotification()">✕ 清除</button>
        </div>
    </div>

    <script>
        const notification = document.getElementById('notification');
        const notifyTime = document.getElementById('notifyTime');
        const status = document.getElementById('status');
        let lastTimestamp = 0;

        // 请求通知权限
        function requestPermission() {{
            if ('Notification' in window) {{
                Notification.requestPermission().then(permission => {{
                    if (permission === 'granted') {{
                        alert('✓ 浏览器通知已启用！');
                    }}
                }});
            }} else {{
                alert('❌ 此浏览器不支持通知功能');
            }}
        }}

        // 显示通知
        function showNotification() {{
            const now = new Date();
            const timeStr = now.toLocaleTimeString('zh-CN', {{ hour12: false }});

            notification.classList.add('show');
            notifyTime.textContent = timeStr;
            status.textContent = '✓ 响应已完成 ' + timeStr;

            // 浏览器通知
            if ('Notification' in window && Notification.permission === 'granted') {{
                new Notification('Claude Code', {{
                    body: '✓ 响应已完成 - ' + timeStr,
                    icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">✓</text></svg>',
                    tag: 'claude-complete'
                }});
            }}

            // 3秒后自动隐藏
            setTimeout(() => {{
                notification.classList.remove('show');
            }}, 3000);
        }}

        // 清除通知
        function clearNotification() {{
            notification.classList.remove('show');
            status.textContent = '🔔 等待 Claude 完成响应...';
        }}

        // 测试通知
        function testNotification() {{
            showNotification();
        }}

        // 轮询检查新通知
        async function checkNotification() {{
            try {{
                const response = await fetch('/api/notify-check');
                const data = await response.json();

                if (data.timestamp && data.timestamp > lastTimestamp) {{
                    lastTimestamp = data.timestamp;
                    showNotification();
                }}
            }} catch (e) {{
                // 忽略错误
            }}
        }}

        // 启动轮询
        setInterval(checkNotification, 1000);
    </script>
</body>
</html>'''
            self.wfile.write(html.encode('utf-8'))

        elif self.path == '/api/notify-check':
            # API: 检查是否有新通知
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()

            timestamp = 0
            if NOTIFY_FILE.exists():
                try:
                    timestamp = int(NOTIFY_FILE.read_text().strip())
                except:
                    pass

            response = json.dumps({{'timestamp': timestamp}})
            self.wfile.write(response.encode('utf-8'))

        else:
            self.send_error(404)

    def log_message(self, format, *args):
        # 减少日志输出
        pass


def main():
    # 确保 .info 目录存在
    NOTIFY_FILE.parent.mkdir(parents=True, exist_ok=True)

    print(f'🚀 Claude Code 通知服务器启动中...')
    print(f'📁 监控文件: {{NOTIFY_FILE}}')
    print(f'🔗 访问地址: http://localhost:{{PORT}}/notify')
    print()
    print(f'💡 在 Codespace 中:')
    print(f'   1. 点击 "Ports" 标签')
    print(f'   2. 找到端口 {{PORT}} 并点击 "Forward"')
    print(f'   3. 打开浏览器访问转发后的地址')
    print()
    print(f'⏹️  按 Ctrl+C 停止服务器')
    print('=' * 50)

    server = HTTPServer(('0.0.0.0', PORT), NotifyHandler)
    server.serve_forever()


if __name__ == '__main__':
    main()
