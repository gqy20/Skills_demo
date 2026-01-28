#!/bin/bash
# PostToolUse Hook - 追踪 .claude/skills/ 目录的变更
# 自动维护 tasks.json 中的技能元数据

set -e

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
TASKS_FILE="$PROJECT_DIR/.info/tasks.json"
CHANGELOG="$PROJECT_DIR/.info/skills_changelog.jsonl"
SKILLS_DIR="$PROJECT_DIR/.claude/skills"

# 颜色输出
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

# 读取 hook 输入
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""' 2>/dev/null)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""' 2>/dev/null)

# 如果没有 jq，直接退出
if ! command -v jq >/dev/null 2>&1; then
    exit 0
fi

# 只处理 skills 目录
if [[ "$FILE_PATH" != *"$SKILLS_DIR"* ]]; then
    exit 0
fi

# 提取技能名称（目录名，不是文件名）
SKILL_DIR=$(dirname "$FILE_PATH" 2>/dev/null)
SKILL_NAME=$(basename "$SKILL_DIR" 2>/dev/null)
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# 判断技能类型
if [[ "$SKILL_NAME" =~ ^u_[a-z_]+$ ]]; then
    SKILL_TYPE="user"
elif [[ "$SKILL_NAME" =~ ^k[0-9]+_[a-z_]+$ ]]; then
    SKILL_TYPE="task"
else
    SKILL_TYPE="builtin"
fi

# 记录变更到 changelog
cat >> "$CHANGELOG" <<EOF
{"timestamp": "$TIMESTAMP", "tool": "$TOOL_NAME", "skill_type": "$SKILL_TYPE", "skill_name": "$SKILL_NAME", "path": "$FILE_PATH"}
EOF

# 处理不同类型的变更
case "$TOOL_NAME" in
    "Write")
        if [ "$SKILL_TYPE" = "user" ]; then
            # 新增 u_ 技能，添加到 user_skills
            TEMP_FILE=$(mktemp)
            jq --arg sid "$SKILL_NAME" --arg time "$TIMESTAMP" \
                '.user_skills[$sid] = {"name": $sid, "level": "proficient", "created_at": $time, "usage_count": 0}' \
                "$TASKS_FILE" > "$TEMP_FILE" 2>/dev/null && mv "$TEMP_FILE" "$TASKS_FILE"
            echo -e "${GREEN}📝 已注册用户技能${NC}: $SKILL_NAME"
        elif [ "$SKILL_TYPE" = "task" ]; then
            # k_ 技能，更新相关任务的步骤
            # 提取任务 ID (如 k01_init_project -> k01)
            TASK_ID=$(echo "$SKILL_NAME" | grep -o '^k[0-9]*' || echo "")
            if [ -n "$TASK_ID" ]; then
                TEMP_FILE=$(mktemp)
                jq --arg tid "$TASK_ID" --arg sid "$SKILL_NAME" \
                    '.tasks[$tid].steps += [$sid] | .tasks[$tid].steps |= unique' \
                    "$TASKS_FILE" > "$TEMP_FILE" 2>/dev/null && mv "$TEMP_FILE" "$TASKS_FILE"
                echo -e "${GREEN}📝 已关联任务技能${NC}: $SKILL_NAME -> $TASK_ID"
            fi
        fi
        ;;
    "Edit")
        if [ "$SKILL_TYPE" = "user" ] || [ "$SKILL_TYPE" = "task" ]; then
            # 更新修改时间
            echo -e "${BLUE}🔄 已更新技能${NC}: $SKILL_NAME"
        fi
        ;;
esac

exit 0
