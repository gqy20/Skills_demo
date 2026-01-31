#!/bin/bash
# Hook: 更新系统状态摘要
# 由其他 hook 调用，更新 .info/.status.json

set -e

# 加载共享库
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

# 初始化
init_colors
check_jq || exit 0

# 初始化状态对象
STATUS='{}'

# 1. 读取任务信息
if [ -f "$TASKS_FILE" ]; then
    # 查找活跃任务
    ACTIVE_TASK=$(json_read "$TASKS_FILE" '.tasks | to_entries | map(select(.value.status == "active")) | .[0].key // ""')

    if [ -n "$ACTIVE_TASK" ]; then
        TASK_NAME=$(json_read "$TASKS_FILE" ".tasks[\"$ACTIVE_TASK\"].name // \"无\"")
        STEPS=$(json_read "$TASKS_FILE" ".tasks[\"$ACTIVE_TASK\"].steps // []")
        STEP_COUNT=$(echo "$STEPS" | jq 'length' 2>/dev/null || echo "0")
        COMPLETED=$(json_read "$TASKS_FILE" ".tasks[\"$ACTIVE_TASK\"].current_step // 0")

        STATUS=$(echo "$STATUS" | jq --arg id "$ACTIVE_TASK" --arg name "$TASK_NAME" \
            --argjson total "$STEP_COUNT" --argjson completed "$COMPLETED" \
            '.active_task = $id | .task_name = $name | .total_steps = $total | .completed_steps = $completed')
    fi

    # 统计任务数量
    TOTAL_TASKS=$(json_read "$TASKS_FILE" '.tasks | length' || echo "0")
    ACTIVE_COUNT=$(json_read "$TASKS_FILE" '[.tasks[] | select(.status == "active")] | length' || echo "0")
    COMPLETED_COUNT=$(json_read "$TASKS_FILE" '[.tasks[] | select(.status == "completed")] | length' || echo "0")

    STATUS=$(echo "$STATUS" | jq --argjson total "$TOTAL_TASKS" --argjson active "$ACTIVE_COUNT" \
        --argjson completed "$COMPLETED_COUNT" \
        '.total_tasks = $total | .active_tasks = $active | .completed_tasks = $completed')

    # 统计 p_ 技能数量（验证技能）
    PROVEN_COUNT=$(get_skill_count "proven")
    STATUS=$(echo "$STATUS" | jq --argjson proven "$PROVEN_COUNT" '.proven_skills_count = $proven')

    # 统计复用次数和热门技能
    if [ -f "$TASKS_FILE" ]; then
        # 检查是否有 p_ 技能
        HAS_PROVEN=$(jq -r '.proven_skills != null and (.proven_skills | length > 0)' "$TASKS_FILE" 2>/dev/null)

        if [ "$HAS_PROVEN" = "true" ]; then
            # 获取复用次数最多的技能
            TOP_SKILL=$(jq -r '.proven_skills | to_entries | sort_by(.value.usage_count // -100) | reverse | .[0].key // ""' "$TASKS_FILE" 2>/dev/null)
            TOP_COUNT=$(jq -r '.proven_skills | to_entries | sort_by(.value.usage_count // -100) | reverse | .[0].value.usage_count // 0' "$TASKS_FILE" 2>/dev/null)
            TOTAL_REUSES=$(jq -r '[.proven_skills[].usage_count // 0] | add // 0' "$TASKS_FILE" 2>/dev/null || echo "0")
            ACTIVE_PROVEN=$(jq -r '[.proven_skills[] | select(.usage_count // 0 > 0)] | length // 0' "$TASKS_FILE" 2>/dev/null || echo "0")

            STATUS=$(echo "$STATUS" | jq --arg top "$TOP_SKILL" --argjson topc "$TOP_COUNT" \
                --argjson total "$TOTAL_REUSES" --argjson active "$ACTIVE_PROVEN" \
                '.top_reused_skill = $top | .top_reuse_count = $topc | .total_reuses = $total | .active_proven_skills = $active')
        else
            # 没有 p_ 技能时设置默认值
            STATUS=$(echo "$STATUS" | jq '.top_reused_skill = "" | .top_reuse_count = 0 | .total_reuses = 0 | .active_proven_skills = 0')
        fi
    fi
fi

# 2. 读取用户画像信息
if [ -f "$PROFILE_FILE" ]; then
    USER_NAME=$(json_read "$PROFILE_FILE" '.basic_info.name // ""')
    USER_ROLE=$(json_read "$PROFILE_FILE" '.basic_info.role // ""')

    STATUS=$(echo "$STATUS" | jq --arg name "$USER_NAME" --arg role "$USER_ROLE" \
        '.user_name = $name | .user_role = $role')
fi

# 3. 统计技能数量（独立于用户画像）
# 包括：内置技能 + u_ 技能 + p_ 技能 + k_ 技能
if [ -d "$SKILLS_DIR" ]; then
    # 统计所有包含 SKILL.md 的目录
    SKILLS_COUNT=$(find "$SKILLS_DIR" -mindepth 2 -maxdepth 2 -name "SKILL.md" -exec dirname {} \; 2>/dev/null | wc -l)
else
    SKILLS_COUNT=0
fi

STATUS=$(echo "$STATUS" | jq --argjson skills "$SKILLS_COUNT" '.skills_count = $skills')

# 4. 检查画像新鲜度
PROFILE_FRESH="true"
if [ -f "$PROFILE_FILE" ] && [ -d "$INFO_DIR" ]; then
    # 获取 info/ 目录最新文件（排除 results/ 子目录）
    LATEST_INFO=$(find "$INFO_DIR" -type f \( -name "*.md" -o -name "*.json" -o -name "*.pdf" -o -name "*.txt" \) \
        -not -path "*/results/*" 2>/dev/null | xargs ls -t 2>/dev/null | head -1)

    if [ -n "$LATEST_INFO" ]; then
        INFO_MTIME=$(get_file_mtime "$LATEST_INFO")
        PROFILE_MTIME=$(get_file_mtime "$PROFILE_FILE")

        if [ -n "$INFO_MTIME" ] && [ -n "$PROFILE_MTIME" ] && [ "$INFO_MTIME" -gt "$PROFILE_MTIME" ]; then
            PROFILE_FRESH="false"
        fi
    fi
fi

STATUS=$(echo "$STATUS" | jq --arg fresh "$PROFILE_FRESH" '.profile_fresh = ($fresh == "true")')

# 5. 添加时间戳
TIMESTAMP=$(get_timestamp)
STATUS=$(echo "$STATUS" | jq --arg ts "$TIMESTAMP" '.updated_at = $ts')

# 写入状态文件
echo "$STATUS" | jq '.' > "$STATUS_FILE"

# 调试输出（可选，取消注释可查看）
# echo -e "${BLUE}🔄 状态已更新${NC}" >&2
# jq '.' "$STATUS_FILE" >&2

exit 0
