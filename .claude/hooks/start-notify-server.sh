#!/bin/bash
# 启动 Claude Code 浏览器通知服务器

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON_SCRIPT="$SCRIPT_DIR/notify-server.py"

echo "🚀 启动 Claude Code 通知服务器..."
echo ""

# 检查 Python 是否可用
if command -v python3 &>/dev/null; then
    python3 "$PYTHON_SCRIPT"
elif command -v python &>/dev/null; then
    python "$PYTHON_SCRIPT"
else
    echo "❌ 错误: 未找到 Python"
    echo "   请安装 Python 3 后再试"
    exit 1
fi
