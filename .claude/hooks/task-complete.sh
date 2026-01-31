#!/bin/bash
# 任务完成声音提示脚本
# 使用 aplay 播放系统声音（适用于无图形界面的环境）

# 加载共享库
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

init_colors

# 声音文件路径（Linux 常见系统声音）
SYSTEM_SOUNDS=(
    "/usr/share/sounds/freedesktop/stereo/complete.oga"     # 任务完成
    "/usr/share/sounds/freedesktop/stereo/success.oga"     # 成功提示
    "/usr/share/sounds/freedesktop/stereo/dialog-information.oga"  # 信息提示
)

# 播放声音
play_sound() {
    local sound_file=""

    # 查找可用的系统声音文件
    for sound in "${SYSTEM_SOUNDS[@]}"; do
        if [ -f "$sound" ]; then
            sound_file="$sound"
            break
        fi
    done

    # 如果没有找到系统声音，尝试 beep
    if [ -z "$sound_file" ]; then
        if command -v beep >/dev/null 2>&1; then
            beep -f 1000 -l 200 2>/dev/null || true
        fi
    fi

    # 使用 aplay 播放声音
    if command -v aplay >/dev/null 2>&1; then
        if [ -n "$sound_file" ]; then
            aplay -q "$sound_file" 2>/dev/null || true
            echo -e "${GREEN}✓${NC} 已播放任务完成提示音"
        else
            # 如果没有声音文件，播放简单的提示音
            if [ -c /dev/tty ]; then
                # 使用终端响铃
                echo -ne "\a" >/dev/tty 2>/dev/null || true
            fi
            echo -e "${GREEN}✓${NC} 已发送终端提示音"
        fi
    else
        echo -e "${YELLOW}⚠️  aplay 未安装${NC}"
        echo "安装命令: sudo apt install alsa-utils"
    fi
}

# 显示终端提示
show_terminal_alert() {
    local message="${1:-✓ 任务完成}"
    # 使用明显的终端提示
    echo ""
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}  $message  ${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
}

# 主函数
task_complete_alert() {
    local message="${1:-任务完成}"

    # 播放声音
    play_sound

    # 显示终端提示
    show_terminal_alert "$message"
}

# 如果提供了参数，执行提示
if [ $# -gt 0 ]; then
    task_complete_alert "$@"
fi

exit 0
