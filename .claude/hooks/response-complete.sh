#!/bin/bash
# 对话完成提示（声音 + 视觉）

# 本地音频文件
LOCAL_SOUND="$CLAUDE_PROJECT_DIR/.claude/assets/complete.wav"

# 终端响铃
if [ -c /dev/tty ]; then
    echo -ne "\a" >/dev/tty 2>/dev/null
fi

# 播放音频文件
if [ -f "$LOCAL_SOUND" ] && command -v aplay >/dev/null 2>&1; then
    aplay -q "$LOCAL_SOUND" 2>/dev/null &
fi

# 视觉提示（修改终端标题）
if [ -c /dev/tty ]; then
    echo -ne "\033]0;✓ 对话完成\007" >/dev/tty 2>/dev/null
fi

# 终端内视觉提示（短暂显示）
echo -ne "\033[90m[对话完成]\033[0m " >&2

exit 0
