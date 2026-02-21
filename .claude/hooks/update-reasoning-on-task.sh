#!/bin/bash
# PostToolUse Hook - 在任务状态变化时更新推理日志

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"
source "$SCRIPT_DIR/lib/reasoning-io.sh"
source "$SCRIPT_DIR/lib/reasoning-render.sh"
source "$SCRIPT_DIR/lib/reasoning-render-mermaid.sh"

init_colors
check_jq || exit 0

REASONING_GLOBAL="$PROJECT_DIR/.info/.reasoning.md"
REASONING_META="$PROJECT_DIR/.info/.reasoning.meta.json"
REASONING_TASK_LOG="$PROJECT_DIR/.info/.reasoning.log.jsonl"
RESULTS_DIR="$PROJECT_DIR/results"

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""' 2>/dev/null)

if [[ "$TOOL_NAME" != "TaskCreate" ]] && [[ "$TOOL_NAME" != "TaskUpdate" ]]; then
    exit 0
fi

TASK_ID=$(echo "$INPUT" | jq -r '.tool_input.subject // empty' 2>/dev/null)
if [ -z "$TASK_ID" ]; then
    TASK_ID=$(echo "$INPUT" | jq -r '.tool_input.taskId // empty' 2>/dev/null)
fi

if [ -z "$TASK_ID" ]; then
    DESCRIPTION=$(echo "$INPUT" | jq -r '.tool_input.description // ""' 2>/dev/null)
    TASK_ID=$(echo "$DESCRIPTION" | grep -oE 'k[0-9]+' | head -1 || echo "")
fi

if [ -z "$TASK_ID" ] && [ -f "$TASKS_FILE" ]; then
    TASK_ID=$(jq -r '.tasks | to_entries[] | select(.value.status == "active" or .value.status == "in_progress") | .key' "$TASKS_FILE" 2>/dev/null | head -1 || echo "")
fi

if [ -z "$TASK_ID" ] || [[ ! "$TASK_ID" =~ ^k[0-9]+$ ]]; then
    exit 0
fi

TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
TIMESTAMP_ISO=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

mkdir -p "$(dirname "$REASONING_GLOBAL")"
mkdir -p "$(dirname "$REASONING_META")"
mkdir -p "$RESULTS_DIR/$TASK_ID"

REASONING_FILE="$RESULTS_DIR/$TASK_ID/.reasoning.md"

load_task_context "$TASK_ID" "$TASKS_FILE"

REASONING_CONTENT=$(extract_reasoning_from_file "$REASONING_FILE")
if [ -z "$REASONING_CONTENT" ]; then
    REASONING_CONTENT=$(recover_reasoning_from_log "$TASK_ID" "$REASONING_TASK_LOG")
fi

if [ "$TOOL_NAME" = "TaskCreate" ] && [ -z "$REASONING_CONTENT" ]; then
    REASONING_CONTENT="<reasoning>
🎯 目标：创建任务 $TASK_NAME
🔍 方法：任务初始化
💡 发现：
  - 任务类型：$TASK_TYPE
  - 计划步骤：$TOTAL_STEPS 个
  - 当前状态：$TASK_STATUS
✅ 决策：任务已创建，准备执行
</reasoning>"
fi

if [ "$TOOL_NAME" = "TaskUpdate" ]; then
    NEW_STATUS=$(echo "$INPUT" | jq -r '.tool_input.status // empty' 2>/dev/null)
    if [ -n "$NEW_STATUS" ]; then
        REASONING_CONTENT="<reasoning>
🎯 目标：更新任务 $TASK_NAME 状态
🔍 方法：状态管理
💡 发现：
  - 原状态：$TASK_STATUS
  - 新状态：$NEW_STATUS
  - 当前进度：$CURRENT_STEP/$TOTAL_STEPS
✅ 决策：任务状态已更新
</reasoning>"
        TASK_STATUS="$NEW_STATUS"
    fi
fi

append_reasoning_event "$TASK_ID" "$TIMESTAMP_ISO" "$TIMESTAMP" "$REASONING_CONTENT" "$REASONING_TASK_LOG"

MERMAID_CHART=$(generate_mermaid_flowchart "$CURRENT_STEP" "$TOTAL_STEPS" "$REASONING_CONTENT" "$TASKS_FILE" "$TASK_ID" "${STEPS_ARRAY[@]}")
STEP_TABLE=$(generate_step_table "$CURRENT_STEP" "$REASONING_CONTENT" "$TASK_ID" "${STEPS_ARRAY[@]}")
PROGRESS_BAR=$(generate_progress_bar "$CURRENT_STEP" "$TOTAL_STEPS")
TIMELINE_CHART=$(generate_timeline "$TASK_ID" "$REASONING_TASK_LOG")
REASONING_DETAILS=$(format_reasoning_details "$REASONING_CONTENT")
CURRENT_STEP_NAME=$(build_current_step_name "$CURRENT_STEP" "$TOTAL_STEPS" "$TASK_ID" "${STEPS_ARRAY[@]}")
STATUS_EMOJI=$(get_status_emoji "$TASK_STATUS")

TASK_CONTENT="# ${TASK_NAME}

**任务 ID**: \`${TASK_ID}\` · **状态**: ${STATUS_EMOJI} ${TASK_STATUS^} · **更新**: ${TIMESTAMP}

---

## 1. 当前进度

${PROGRESS_BAR}

**当前步骤**: ${CURRENT_STEP_NAME}

## 2. 执行流程图

${MERMAID_CHART}

${STEP_TABLE}

---

## 3. 推理详情

${REASONING_DETAILS}

---

## 4. 执行时间线

${TIMELINE_CHART}
"

echo "$TASK_CONTENT" > "$REASONING_FILE"

update_reasoning_meta \
    "$REASONING_META" \
    "$TASK_ID" \
    "$TASK_NAME" \
    "$TASK_STATUS" \
    "$TASK_TYPE" \
    "$CURRENT_STEP" \
    "$TOTAL_STEPS" \
    "$TIMESTAMP" \
    "$REASONING_FILE"

GLOBAL_INDEX=$(generate_global_reasoning_index "$REASONING_META" "$TIMESTAMP")
echo "$GLOBAL_INDEX" > "$REASONING_GLOBAL"

echo -e "${BLUE}📝 任务状态推理日志已更新${NC}: ${TASK_ID}" >&2

exit 0
