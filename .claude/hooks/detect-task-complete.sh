#!/bin/bash
# Hook: 检测任务完成并标记技能升级待处理
# 触发时机: TaskUpdate 将任务状态设为 completed 时

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
TASK_ID=$(echo "$INPUT" | jq -r '.tool_input.taskId // ""' 2>/dev/null)
NEW_STATUS=$(echo "$INPUT" | jq -r '.tool_input.status // ""' 2>/dev/null)

# 只处理 TaskUpdate 且状态为 completed 的情况
if [ "$TOOL_NAME" != "TaskUpdate" ] || [ "$NEW_STATUS" != "completed" ]; then
    exit 0
fi

# 验证任务 ID 格式
if [[ ! "$TASK_ID" =~ ^k[0-9]+$ ]]; then
    exit 0
fi

# 检查任务文件是否存在
if [ ! -f "$TASKS_FILE" ]; then
    exit 0
fi

# 检查任务是否确实存在
if ! json_read "$TASKS_FILE" ".tasks[\"$TASK_ID\"]" >/dev/null 2>&1; then
    exit 0
fi

# 扫描任务的 k_ 技能
K_SKILLS=()
for skill_dir in "$SKILLS_DIR"/${TASK_ID}_*; do
    if [ -d "$skill_dir" ]; then
        skill_name=$(basename "$skill_dir")
        # 检查是否是有效的 k_ 技能目录（有 SKILL.md）
        if [ -f "$skill_dir/SKILL.md" ]; then
            K_SKILLS+=("$skill_name")
        fi
    fi
done

# 如果没有找到 k_ 技能，退出
if [ ${#K_SKILLS[@]} -eq 0 ]; then
    exit 0
fi

TIMESTAMP=$(get_timestamp)

# 构建可升级技能列表
SKILLS_JSON=$(printf '%s\n' "${K_SKILLS[@]}" | jq -R . | jq -s .)

# 设置升级待处理标记
atomic_json_update "$TASKS_FILE" \
    --arg tid "$TASK_ID" \
    --argjson skills "$SKILLS_JSON" \
    --arg time "$TIMESTAMP" \
    '.tasks[$tid].upgrade_pending = true | .tasks[$tid].upgrade_candidates = $skills | .tasks[$tid].upgrade_detected_at = $time'

# 输出提示信息
echo -e "${GREEN}📋 任务完成，已记录可升级技能${NC}"
echo -e "${BLUE}任务${NC}: $TASK_ID"
echo -e "${BLUE}可升级技能${NC}: ${K_SKILLS[*]}"
echo -e "${YELLOW}💡 使用 /commander upgrade 查看升级选项${NC}"

exit 0
