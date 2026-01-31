#!/bin/bash
# Hook: 更新系统状态摘要
# 由其他 hook 调用，更新 .info/.status.json

set -e

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
STATUS_FILE="$PROJECT_DIR/.info/.status.json"
TASKS_FILE="$PROJECT_DIR/.info/tasks.json"
PROFILE_FILE="$PROJECT_DIR/.info/usr.json"
INFO_DIR="$PROJECT_DIR/info"

# 颜色输出（用于调试）
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

# 检查 jq 是否安装
if ! command -v jq >/dev/null 2>&1; then
    echo "⚠️  需要安装 jq: brew install jq 或 apt install jq"
    exit 0
fi

# 初始化状态对象
STATUS='{}'

# 1. 读取任务信息
if [ -f "$TASKS_FILE" ]; then
    # 查找活跃任务
    ACTIVE_TASK=$(jq -r '.tasks | to_entries | map(select(.value.status == "active")) | .[0].key // ""' "$TASKS_FILE" 2>/dev/null)

    if [ -n "$ACTIVE_TASK" ]; then
        TASK_NAME=$(jq -r ".tasks[\"$ACTIVE_TASK\"].name // \"无\"" "$TASKS_FILE" 2>/dev/null)
        STEPS=$(jq -r ".tasks[\"$ACTIVE_TASK\"].steps // []" "$TASKS_FILE" 2>/dev/null)
        STEP_COUNT=$(echo "$STEPS" | jq 'length' 2>/dev/null || echo "0")

        # 计算完成步骤数（读取 current_step 字段）
        COMPLETED=$(jq -r ".tasks[\"$ACTIVE_TASK\"].current_step // 0" "$TASKS_FILE" 2>/dev/null)

        STATUS=$(echo "$STATUS" | jq --arg id "$ACTIVE_TASK" --arg name "$TASK_NAME" \
            --argjson total "$STEP_COUNT" --argjson completed "$COMPLETED" \
            '.active_task = $id | .task_name = $name | .total_steps = $total | .completed_steps = $completed')
    fi

    # 统计任务数量
    TOTAL_TASKS=$(jq -r '.tasks | length' "$TASKS_FILE" 2>/dev/null || echo "0")
    ACTIVE_COUNT=$(jq -r '[.tasks[] | select(.status == "active")] | length' "$TASKS_FILE" 2>/dev/null || echo "0")
    COMPLETED_COUNT=$(jq -r '[.tasks[] | select(.status == "completed")] | length' "$TASKS_FILE" 2>/dev/null || echo "0")

    STATUS=$(echo "$STATUS" | jq --argjson total "$TOTAL_TASKS" --argjson active "$ACTIVE_COUNT" \
        --argjson completed "$COMPLETED_COUNT" \
        '.total_tasks = $total | .active_tasks = $active | .completed_tasks = $completed')
fi

# 2. 读取用户画像信息
if [ -f "$PROFILE_FILE" ]; then
    USER_NAME=$(jq -r '.basic_info.name // ""' "$PROFILE_FILE" 2>/dev/null)
    USER_ROLE=$(jq -r '.basic_info.role // ""' "$PROFILE_FILE" 2>/dev/null)
    SKILLS_COUNT=$(jq -r '.user_skills | length // 0' "$PROFILE_FILE" 2>/dev/null)

    STATUS=$(echo "$STATUS" | jq --arg name "$USER_NAME" --arg role "$USER_ROLE" \
        --argjson skills "$SKILLS_COUNT" \
        '.user_name = $name | .user_role = $role | .skills_count = $skills')
fi

# 3. 检查画像新鲜度
PROFILE_FRESH="true"
if [ -f "$PROFILE_FILE" ] && [ -d "$INFO_DIR" ]; then
    # 获取 info/ 目录最新文件（排除 results/ 子目录）
    LATEST_INFO=$(find "$INFO_DIR" -type f \( -name "*.md" -o -name "*.json" -o -name "*.pdf" -o -name "*.txt" \) \
        -not -path "*/results/*" 2>/dev/null | xargs ls -t 2>/dev/null | head -1)

    if [ -n "$LATEST_INFO" ]; then
        # 获取文件修改时间
        if stat -f %m "$LATEST_INFO" >/dev/null 2>&1; then
            INFO_MTIME=$(stat -f %m "$LATEST_INFO")
            PROFILE_MTIME=$(stat -f %m "$PROFILE_FILE")
        else
            INFO_MTIME=$(stat -c %Y "$LATEST_INFO" 2>/dev/null)
            PROFILE_MTIME=$(stat -c %Y "$PROFILE_FILE" 2>/dev/null)
        fi

        if [ -n "$INFO_MTIME" ] && [ -n "$PROFILE_MTIME" ] && [ "$INFO_MTIME" -gt "$PROFILE_MTIME" ]; then
            PROFILE_FRESH="false"
        fi
    fi
fi

STATUS=$(echo "$STATUS" | jq --arg fresh "$PROFILE_FRESH" '.profile_fresh = ($fresh == "true")')

# 4. 添加时间戳
STATUS=$(echo "$STATUS" | jq --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '.updated_at = $ts')

# 写入状态文件
echo "$STATUS" | jq '.' > "$STATUS_FILE"

# 调试输出（可选，取消注释可查看）
# echo -e "${BLUE}🔄 状态已更新${NC}" >&2
# jq '.' "$STATUS_FILE" >&2

exit 0
