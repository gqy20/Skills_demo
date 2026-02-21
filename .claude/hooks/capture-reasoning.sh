#!/bin/bash
# PostToolUse Hook - 捕获推理块并维护推理日志

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

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""' 2>/dev/null)
NEW_CONTENT=$(echo "$INPUT" | jq -r '.tool_input.content // ""' 2>/dev/null)

if [[ ! "$FILE_PATH" =~ results/[a-z]+[0-9]*/\.reasoning\.md$ ]]; then
    exit 0
fi

mkdir -p "$(dirname "$REASONING_GLOBAL")"
mkdir -p "$(dirname "$REASONING_META")"

TASK_ID=$(basename "$(dirname "$FILE_PATH")")
if [ -z "$TASK_ID" ]; then
    exit 0
fi

TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
TIMESTAMP_ISO=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

load_task_context "$TASK_ID" "$TASKS_FILE"

REASONING_CONTENT=$(resolve_reasoning_content "$NEW_CONTENT" "$FILE_PATH" "$TASK_ID" "$REASONING_TASK_LOG")
REASONING_CONTENT="${REASONING_CONTENT:-}"
append_reasoning_event "$TASK_ID" "$TIMESTAMP_ISO" "$TIMESTAMP" "$REASONING_CONTENT" "$REASONING_TASK_LOG"

MERMAID_CHART=$(generate_mermaid_flowchart "$CURRENT_STEP" "$TOTAL_STEPS" "$REASONING_CONTENT" "$TASKS_FILE" "$TASK_ID" "${STEPS_ARRAY[@]}")
STEP_TABLE=$(generate_step_table "$CURRENT_STEP" "$REASONING_CONTENT" "$TASK_ID" "${STEPS_ARRAY[@]}")
PROGRESS_BAR=$(generate_progress_bar "$CURRENT_STEP" "$TOTAL_STEPS")
TIMELINE_CHART=$(generate_timeline "$TASK_ID" "$REASONING_TASK_LOG")
REASONING_DETAILS=$(format_reasoning_details "$REASONING_CONTENT")

MERMAID_CODE=$(echo "$MERMAID_CHART" | sed '1d;$d')
if ! validate_mermaid_syntax "$MERMAID_CODE"; then
    echo -e "${YELLOW}⚠ Mermaid 图可能存在渲染问题，已生成步骤详情表作为备选${NC}" >&2
fi

CURRENT_STEP_NAME=$(build_current_step_name "$CURRENT_STEP" "$TOTAL_STEPS" "$TASK_ID" "${STEPS_ARRAY[@]}")
STATUS_EMOJI=$(get_status_emoji "$TASK_STATUS")

TASK_CONTENT="# ${TASK_NAME}

**任务 ID**: \`${TASK_ID}\` · **状态**: ${STATUS_EMOJI} ${TASK_STATUS^} · **更新**: ${TIMESTAMP}

---

## 1. 当前进度

$PROGRESS_BAR

**当前步骤**: ${CURRENT_STEP_NAME}

## 2. 执行流程图

$MERMAID_CHART

$STEP_TABLE

---

## 3. 推理详情

$REASONING_DETAILS

---

## 4. 执行时间线

$TIMELINE_CHART
"

echo "$TASK_CONTENT" > "$FILE_PATH"

update_reasoning_meta \
    "$REASONING_META" \
    "$TASK_ID" \
    "$TASK_NAME" \
    "$TASK_STATUS" \
    "$TASK_TYPE" \
    "$CURRENT_STEP" \
    "$TOTAL_STEPS" \
    "$TIMESTAMP" \
    "$FILE_PATH"

GLOBAL_INDEX=$(generate_global_reasoning_index "$REASONING_META" "$TIMESTAMP")
echo "$GLOBAL_INDEX" > "$REASONING_GLOBAL"

echo -e "${BLUE}📝 推理日志已更新${NC}: ${TASK_ID} (${CURRENT_STEP}/${TOTAL_STEPS})" >&2

exit 0
