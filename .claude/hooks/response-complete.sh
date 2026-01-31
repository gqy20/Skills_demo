#!/bin/bash
# 对话完成提示 - Codespace 优化版
# 使用增强视觉效果和浏览器通知

# ANSI 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
BLINK='\033[5m'
REVERSE='\033[7m'
NC='\033[0m'

# 临时文件用于记录完成状态
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
STATE_DIR="$PROJECT_DIR/.info"
STATE_FILE="$STATE_DIR/.last_complete"
mkdir -p "$STATE_DIR"

# 读取 JSON 输入
input=$(cat 2>/dev/null || echo "{}")
hook_event=$(echo "$input" | jq -r '.hook_event_name // "Stop"' 2>/dev/null || echo "Stop")

# 终端响铃
{ echo -ne "\a" >/dev/tty; } 2>/dev/null || true

# 修改终端标题（支持多窗口）
{ echo -ne "\033]0;✓ Claude 响应完成\007" >/dev/tty; } 2>/dev/null || true
{ echo -ne "\033]2;✓ Claude 响应完成\007" >/dev/tty; } 2>/dev/null || true

# 写入状态文件（供 statusline 读取）
echo "$(date +%s)" > "$STATE_FILE"

# 显示增强的视觉提示
show_visual_alert() {
    # 使用 stderr 避免干扰输出
    exec 3>&2

    # 空行分隔
    echo "" >&3

    # 顶部闪烁边框
    echo -ne "${BLINK}${BOLD}${CYAN}" >&3
    printf '█%.0s' {1..50} >&3
    echo -e "${NC}" >&3

    # 主消息 - 巨大醒目
    echo -ne "${BOLD}${REVERSE}${GREEN}" >&3
    echo "                                                    " >&3
    echo "   ✓  CLAUDE 响应完成  $(date '+%H:%M:%S')   " >&3
    echo "                                                    " >&3
    echo -e "${NC}" >&3

    # 底部边框
    echo -ne "${BOLD}${CYAN}" >&3
    printf '█%.0s' {1..50} >&3
    echo -e "${NC}" >&3

    # 额外提示行
    echo -ne "${DIM}${YELLOW}" >&3
    echo "─── 按 Ctrl+L 清屏 / 输入继续对话 ───" >&3
    echo -e "${NC}" >&3

    # 恢复 stderr
    exec 3>&-
}

# 执行视觉提示
show_visual_alert

# 尝试触发浏览器通知（通过端口转发）
# 用户可以在浏览器打开 http://localhost:8888/notify
trigger_browser_notify() {
    local notify_socket="$STATE_DIR/.notify.sock"
    if [ -S "$notify_socket" ] 2>/dev/null; then
        echo "complete" | nc -U "$notify_socket" 2>/dev/null || true
    fi
}

# 后台触发浏览器通知
trigger_browser_notify &

exit 0
