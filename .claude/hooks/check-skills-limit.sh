#!/bin/bash
# Hook: 检测技能数量是否超过阈值
# 触发时机: Write/Edit skill files 时
# 作用: 当技能数量超过阈值时，设置归档待处理标记

set -e

# 加载共享库
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

# 初始化
init_colors
check_jq || exit 0

# 技能数量阈值
MAX_USER_SKILLS=5
MAX_PROVEN_SKILLS=10
MAX_TASK_SKILLS=20  # k_ 技能较多，设置较高阈值

# 读取 hook 输入
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""' 2>/dev/null)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""' 2>/dev/null)

# 只处理 Write/Edit skill files
if [ "$TOOL_NAME" != "Write" ] && [ "$TOOL_NAME" != "Edit" ]; then
    exit 0
fi

# 只处理 skills 目录
if [[ "$FILE_PATH" != *"$SKILLS_DIR"* ]]; then
    exit 0
fi

# 统计各类型技能数量
U_COUNT=$(get_skill_count "user")
P_COUNT=$(get_skill_count "proven")
K_COUNT=$(get_skill_count "task")
TOTAL_COUNT=$((U_COUNT + P_COUNT + K_COUNT))

# 检查是否超过阈值
NEED_ARCHIVE=false
ARCHIVE_REASON=""

if [ "$U_COUNT" -gt "$MAX_USER_SKILLS" ]; then
    NEED_ARCHIVE=true
    ARCHIVE_REASON="u_ 技能超过阈值 ($U_COUNT > $MAX_USER_SKILLS)"
fi

if [ "$P_COUNT" -gt "$MAX_PROVEN_SKILLS" ]; then
    NEED_ARCHIVE=true
    ARCHIVE_REASON="${ARCHIVE_REASON:+$ARCHIVE_REASON, }p_ 技能超过阈值 ($P_COUNT > $MAX_PROVEN_SKILLS)"
fi

if [ "$K_COUNT" -gt "$MAX_TASK_SKILLS" ]; then
    NEED_ARCHIVE=true
    ARCHIVE_REASON="${ARCHIVE_REASON:+$ARCHAVE_REASON, }k_ 技能超过阈值 ($K_COUNT > $MAX_TASK_SKILLS)"
fi

# 如果需要归档，设置标记
if [ "$NEED_ARCHIVE" = true ]; then
    TIMESTAMP=$(get_timestamp)

    # 在 tasks.json 中设置归档待处理标记
    if ! json_read "$TASKS_FILE" '.archive_pending' >/dev/null 2>&1; then
        atomic_json_update "$TASKS_FILE" \
            --arg time "$TIMESTAMP" \
            '.archive_pending = true | .archive_detected_at = $time | .archive_reason = ""'
    fi

    atomic_json_update "$TASKS_FILE" \
        --arg reason "$ARCHIVE_REASON" \
        --argjson u "$U_COUNT" --argjson p "$P_COUNT" --argjson k "$K_COUNT" \
        '.archive_reason = $reason | .skill_counts = {"user": $u, "proven": $p, "task": $k, "total": ($u + $p + $k)}'

    echo -e "${YELLOW}⚠️  技能数量超过阈值${NC}"
    echo -e "${YELLOW}原因${NC}: $ARCHIVE_REASON"
    echo -e "${YELLOW}💡 使用 /commander cleanup 查看并归档低频技能${NC}"
fi

exit 0
