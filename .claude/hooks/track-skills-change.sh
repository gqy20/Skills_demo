#!/bin/bash
# PostToolUse Hook - 追踪 .claude/skills/ 目录的变更
# 自动维护 tasks.json 中的技能元数据

set -e

# 加载共享库
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

# 初始化
init_colors
check_jq || exit 0

# 读取 hook 输入
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""' 2>/dev/null)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""' 2>/dev/null)

# 只处理 skills 目录
if [[ "$FILE_PATH" != *"$SKILLS_DIR"* ]]; then
    exit 0
fi

# 提取技能名称（目录名，不是文件名）
SKILL_DIR=$(dirname "$FILE_PATH" 2>/dev/null)
SKILL_NAME=$(basename "$SKILL_DIR" 2>/dev/null)
TIMESTAMP=$(get_timestamp)

# 判断技能类型
SKILL_TYPE=$(get_skill_type "$SKILL_NAME")

# 记录变更到 changelog
log_changelog "$TOOL_NAME" "$SKILL_TYPE" "$SKILL_NAME" "$FILE_PATH"

# 技能数量控制（仅对 Write 操作生效）
if [ "$TOOL_NAME" = "Write" ]; then
    if [ "$SKILL_TYPE" = "user" ]; then
        U_COUNT=$(get_skill_count "user")
        check_skill_limit "user" "$U_COUNT" || exit 1
    elif [ "$SKILL_TYPE" = "proven" ]; then
        P_COUNT=$(get_skill_count "proven")
        check_skill_limit "proven" "$P_COUNT" || exit 1
    fi
fi

# 处理不同类型的变更
case "$TOOL_NAME" in
    "Write")
        if [ "$SKILL_TYPE" = "user" ]; then
            # 新增 u_ 技能，添加到 user_skills
            atomic_json_update "$TASKS_FILE" \
                --arg sid "$SKILL_NAME" --arg time "$TIMESTAMP" \
                '.user_skills[$sid] = {"name": $sid, "level": "proficient", "created_at": $time, "usage_count": 0}'
            echo -e "${GREEN}📝 已注册用户技能${NC}: $SKILL_NAME"
        elif [ "$SKILL_TYPE" = "task" ]; then
            # k_ 技能，更新相关任务的步骤
            TASK_ID=$(echo "$SKILL_NAME" | grep -o '^k[0-9]*' || echo "")
            if [ -n "$TASK_ID" ]; then
                atomic_json_update "$TASKS_FILE" \
                    --arg tid "$TASK_ID" --arg sid "$SKILL_NAME" \
                    '.tasks[$tid].steps += [$sid] | .tasks[$tid].steps |= unique'
                echo -e "${GREEN}📝 已关联任务技能${NC}: $SKILL_NAME -> $TASK_ID"
            fi
        elif [ "$SKILL_TYPE" = "proven" ]; then
            # p_ 技能，添加到 proven_skills（如果不存在）
            if json_read "$TASKS_FILE" '.proven_skills' >/dev/null 2>&1; then
                # 已存在，检查该技能是否已注册
                if ! json_read "$TASKS_FILE" ".proven_skills[\"$SKILL_NAME\"]" >/dev/null 2>&1; then
                    atomic_json_update "$TASKS_FILE" \
                        --arg sid "$SKILL_NAME" --arg time "$TIMESTAMP" \
                        '.proven_skills[$sid] = {"source": "manual", "derived_at": $time, "usage_count": 0, "related_tasks": [], "success_rate": 1.0}'
                    echo -e "${GREEN}📝 已注册验证技能${NC}: $SKILL_NAME"
                fi
            else
                # 创建 proven_skills 对象
                atomic_json_update "$TASKS_FILE" \
                    --arg sid "$SKILL_NAME" --arg time "$TIMESTAMP" \
                    '.proven_skills = {} | .proven_skills[$sid] = {"source": "manual", "derived_at": $time, "usage_count": 0, "related_tasks": [], "success_rate": 1.0}'
                echo -e "${GREEN}📝 已注册验证技能${NC}: $SKILL_NAME"
            fi
        fi
        ;;
    "Edit")
        if [ "$SKILL_TYPE" = "user" ] || [ "$SKILL_TYPE" = "task" ] || [ "$SKILL_TYPE" = "proven" ]; then
            echo -e "${BLUE}🔄 已更新技能${NC}: $SKILL_NAME"
        fi
        ;;
esac

exit 0
