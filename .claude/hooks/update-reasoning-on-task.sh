#!/bin/bash
# PostToolUse Hook - 在任务状态变化时更新推理日志
# 当 TaskCreate 或 TaskUpdate 被调用时触发
# 确保每次任务操作都能维护 .reasoning.md

set -e

# 加载共享库
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

# 初始化
init_colors
check_jq || exit 0

# 定义文件路径
REASONING_GLOBAL="$PROJECT_DIR/.info/.reasoning.md"
REASONING_META="$PROJECT_DIR/.info/.reasoning.meta.json"
REASONING_TASK_LOG="$PROJECT_DIR/.info/.reasoning.log.jsonl"
TASKS_FILE="$PROJECT_DIR/.info/tasks.json"
RESULTS_DIR="$PROJECT_DIR/results"

# 读取 hook 输入
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""' 2>/dev/null)

# 只处理 TaskCreate 和 TaskUpdate
if [[ "$TOOL_NAME" != "TaskCreate" ]] && [[ "$TOOL_NAME" != "TaskUpdate" ]]; then
    exit 0
fi

# 获取任务信息（从 tool_input 提取）
TASK_ID=$(echo "$INPUT" | jq -r '.tool_input.subject // empty' 2>/dev/null)
if [ -z "$TASK_ID" ]; then
    # 尝试从 task_id 字段获取
    TASK_ID=$(echo "$INPUT" | jq -r '.tool_input.taskId // empty' 2>/dev/null)
fi

# 如果没有明确的任务 ID，尝试从 description 推断
if [ -z "$TASK_ID" ]; then
    DESCRIPTION=$(echo "$INPUT" | jq -r '.tool_input.description // ""' 2>/dev/null)
    # 从 description 中匹配 k[0-9]+ 模式
    TASK_ID=$(echo "$DESCRIPTION" | grep -oE 'k[0-9]+' | head -1 || echo "")
fi

# 如果仍然没有任务 ID，从 tasks.json 获取最新的活跃任务
if [ -z "$TASK_ID" ] && [ -f "$TASKS_FILE" ]; then
    # 获取状态为 active 或 in_progress 的任务
    TASK_ID=$(jq -r '.tasks | to_entries[] | select(.value.status == "active" or .value.status == "in_progress") | .key' "$TASKS_FILE" 2>/dev/null | head -1 || echo "")
fi

# 如果还是没有任务 ID，退出
if [ -z "$TASK_ID" ]; then
    exit 0
fi

# 获取当前时间戳
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
TIMESTAMP_ISO=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

# 确保目录存在
mkdir -p "$(dirname "$REASONING_GLOBAL")"
mkdir -p "$(dirname "$REASONING_META")"
mkdir -p "$RESULTS_DIR/$TASK_ID"

# 推理文件路径
REASONING_FILE="$RESULTS_DIR/$TASK_ID/.reasoning.md"

# ==================== 从 tasks.json 读取任务状态 ====================

TASK_NAME="未知任务"
TASK_STATUS="unknown"
TASK_TYPE="general"
CURRENT_STEP=0
STEPS_ARRAY=()
TOTAL_STEPS=0

if [ -f "$TASKS_FILE" ]; then
    TASK_NAME=$(json_read "$TASKS_FILE" ".tasks[\"$TASK_ID\"].name // \"$TASK_ID 任务\"" 2>/dev/null || echo "$TASK_ID 任务")
    TASK_STATUS=$(json_read "$TASKS_FILE" ".tasks[\"$TASK_ID\"].status // \"unknown\"" 2>/dev/null || echo "unknown")
    TASK_TYPE=$(json_read "$TASKS_FILE" ".tasks[\"$TASK_ID\"].type // \"general\"" 2>/dev/null || echo "general")
    CURRENT_STEP=$(json_read "$TASKS_FILE" ".tasks[\"$TASK_ID\"].current_step // 0" 2>/dev/null || echo "0")

    # 读取步骤数组
    STEPS_JSON=$(json_read "$TASKS_FILE" ".tasks[\"$TASK_ID\"].steps // []" 2>/dev/null || echo "[]")
    TOTAL_STEPS=$(echo "$STEPS_JSON" | jq 'length' 2>/dev/null || echo "0")

    # 将步骤转换为 bash 数组
    if [ "$TOTAL_STEPS" -gt 0 ]; then
        while IFS= read -r step; do
            STEPS_ARRAY+=("$step")
        done < <(echo "$STEPS_JSON" | jq -r '.[]' 2>/dev/null)
    fi
fi

# ==================== 从现有文件读取推理内容 ====================

REASONING_CONTENT=""
if [ -f "$REASONING_FILE" ]; then
    # 从现有文件提取 <reasoning> 标签
    REASONING_CONTENT=$(sed -n '/<reasoning>/,/<\/reasoning>/p' "$REASONING_FILE" 2>/dev/null || echo "")
fi

# 如果没有找到，尝试从日志恢复
if [ -z "$REASONING_CONTENT" ] && [ -f "$REASONING_TASK_LOG" ]; then
    REASONING_CONTENT=$(jq -s -r \
        "[.[] | select(.task == \"$TASK_ID\" and (.content // \"\" | length) > 0)] | \
         .[-1].content // \"\"" \
        "$REASONING_TASK_LOG" 2>/dev/null)
fi

# 如果是 TaskCreate（新任务创建），添加初始推理内容
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

# 如果是 TaskUpdate，添加状态更新推理
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
    fi
fi

# 追加推理事件到日志
EVENT_JSON=$(jq -n \
    --arg task "$TASK_ID" \
    --arg time "$TIMESTAMP_ISO" \
    --arg time_readable "$TIMESTAMP" \
    --arg content "$REASONING_CONTENT" \
    '{"task": $task, "timestamp": $time, "timestamp_readable": $time_readable, "content": $content}')
echo "$EVENT_JSON" >> "$REASONING_TASK_LOG"

# ==================== 生成 Mermaid 流程图（简化版） ====================

generate_mermaid_flowchart() {
    local current=$1
    local total=$2
    shift 2
    local steps=("$@")

    echo '```mermaid'
    echo 'flowchart LR'

    for i in "${!steps[@]}"; do
        local step_name="${steps[$i]}"
        local step_num=$((i + 1))
        local node_id="S${step_num}"

        # 清理步骤名称
        local display_name=$(echo "$step_name" | sed "s/^${TASK_ID}_//" | sed 's/_/ /g' | sed 's/\b\(.\)/\u\1/g')

        echo "    ${node_id}[\"步骤 ${step_num}: ${display_name}\"]"

        # 生成连接
        if [ $i -lt $((${total} - 1)) ]; then
            local next_node="S$((step_num + 1))"
            echo "    ${node_id} --> ${next_node}"
        fi
    done

    echo ""

    # 样式定义
    if [ $current -gt 0 ]; then
        for i in $(seq 0 $((current - 1))); do
            local step_num=$((i + 1))
            echo "    style S${step_num} fill:#90EE90,stroke:#333,stroke-width:2px"
        done
    fi

    if [ $current -ge 0 ] && [ $current -lt $total ]; then
        local step_num=$((current + 1))
        echo "    style S${step_num} fill:#FFD700,stroke:#333,stroke-width:3px"
    fi

    if [ $((current + 2)) -le $total ]; then
        for i in $(seq $((current + 1)) $((total - 1))); do
            local step_num=$((i + 1))
            echo "    style S${step_num} fill:#f0f0f0,stroke:#999,stroke-width:1px"
        done
    fi

    echo '```'
}

# ==================== 生成进度条 ====================

generate_progress_bar() {
    local current=$1
    local total=$2

    if [ $total -eq 0 ]; then
        echo "**进度**: 准备中"
        return
    fi

    local percent=$((current * 100 / total))
    local filled=$((current * 10 / total))
    local empty=$((10 - filled))

    local bar=""
    for ((i=0; i<filled; i++)); do bar+="█"; done
    for ((i=0; i<empty; i++)); do bar+="░"; done

    echo "**进度**: \`${bar}\` ${current}/${total} (${percent}%)"
}

# ==================== 格式化推理详情 ====================

format_reasoning_details() {
    local reasoning_content="$1"

    if [ -z "$reasoning_content" ]; then
        echo "> 📋 **推理详情暂无**"
        echo ">"
        echo "> 该任务的推理内容将在执行过程中记录。"
        return
    fi

    # 移除 <reasoning> 标签
    local clean_content="${reasoning_content#<reasoning>}"
    clean_content="${clean_content%</reasoning>}"

    # 转换为引用块格式
    while IFS= read -r line || [ -n "$line" ]; do
        if [ -z "$line" ]; then
            echo ">"
        else
            echo "> ${line}"
        fi
    done <<< "$clean_content"
}

# ==================== 生成时间线 ====================

generate_timeline() {
    echo '```mermaid'
    echo 'timeline'
    local date_only=$(date '+%Y-%m-%d')
    local current_time=$(date '+%H:%M')

    echo "    $date_only : $current_time 当前更新"

    if [ -f "$REASONING_TASK_LOG" ]; then
        jq -s "[.[] | select(.task == \"$TASK_ID\" and (.content | length) > 0)] | .[-5:] | reverse | .[].timestamp_readable" \
            "$REASONING_TASK_LOG" 2>/dev/null | while read -r ts; do
            if [ -n "$ts" ]; then
                local clean_ts=$(echo "$ts" | tr -d '"')
                local event_date=$(echo "$clean_ts" | cut -d' ' -f1)
                local event_time=$(echo "$clean_ts" | cut -d' ' -f2)
                echo "    ${event_date} : ${event_time} 任务更新"
            fi
        done
    fi

    echo '```'
}

# ==================== 生成任务级推理日志 ====================

MERMAID_CHART=$(generate_mermaid_flowchart $CURRENT_STEP $TOTAL_STEPS "${STEPS_ARRAY[@]}")
PROGRESS_BAR=$(generate_progress_bar $CURRENT_STEP $TOTAL_STEPS)
TIMELINE_CHART=$(generate_timeline)
REASONING_DETAILS=$(format_reasoning_details "$REASONING_CONTENT")

# 获取当前步骤名称
if [ $CURRENT_STEP -lt $TOTAL_STEPS ] && [ $TOTAL_STEPS -gt 0 ]; then
    CURRENT_STEP_NAME="${STEPS_ARRAY[$CURRENT_STEP]}"
    CURRENT_STEP_NAME="${CURRENT_STEP_NAME#$TASK_ID}"
    CURRENT_STEP_NAME="${CURRENT_STEP_NAME#_}"
    CURRENT_STEP_NAME="${CURRENT_STEP_NAME^}"
else
    CURRENT_STEP_NAME="已完成"
fi

# 获取状态 emoji
get_status_emoji() {
    local status="$1"
    case "$status" in
        completed|done) echo "✅" ;;
        active|in_progress) echo "🔄" ;;
        pending) echo "⏳" ;;
        failed|error) echo "❌" ;;
        *) echo "" ;;
    esac
}

STATUS_EMOJI=$(get_status_emoji "$TASK_STATUS")

# 生成任务级日志内容
TASK_CONTENT="# ${TASK_NAME}

**任务 ID**: \`${TASK_ID}\` · **状态**: ${STATUS_EMOJI} ${TASK_STATUS^} · **更新**: ${TIMESTAMP}

---

## 1. 当前进度

${PROGRESS_BAR}

**当前步骤**: ${CURRENT_STEP_NAME}

## 2. 执行流程图

${MERMAID_CHART}

**步骤详情**：
"

# 添加步骤表
TASK_CONTENT="${TASK_CONTENT}
| 步骤 | 技能名称 | 状态 |
|:----:|---------|:----:|
"

for i in "${!STEPS_ARRAY[@]}"; do
    local step_name="${STEPS_ARRAY[$i]}"
    local step_num=$((i + 1))
    local status=""
    if [ $i -lt $CURRENT_STEP ]; then
        status="✅ 完成"
    elif [ $i -eq $CURRENT_STEP ]; then
        status="🔄 进行中"
    else
        status="⏳ 待执行"
    fi
    TASK_CONTENT="${TASK_CONTENT}| ${step_num} | \`${step_name}\` | ${status} |
"
done

TASK_CONTENT="${TASK_CONTENT}
---

## 3. 推理详情

${REASONING_DETAILS}

---

## 4. 执行时间线

${TIMELINE_CHART}
"

# 写入任务级推理日志
echo "$TASK_CONTENT" > "$REASONING_FILE"

# ==================== 更新任务元数据 ====================

if [ -f "$REASONING_META" ]; then
    temp_meta=$(jq --arg id "$TASK_ID" \
        --arg name "$TASK_NAME" \
        --arg status "$TASK_STATUS" \
        --arg type "$TASK_TYPE" \
        --argjson step "$CURRENT_STEP" \
        --argjson total "$TOTAL_STEPS" \
        --arg time "$TIMESTAMP" \
        --arg file "$REASONING_FILE" \
        '.tasks[$id] = {
            "id": $id,
            "name": $name,
            "status": $status,
            "type": $type,
            "current_step": $step,
            "total_steps": $total,
            "updated_at": $time,
            "reasoning_file": $file
        }' "$REASONING_META")
    echo "$temp_meta" > "$REASONING_META"
else
    cat > "$REASONING_META" << EOF
{
  "updated_at": "$TIMESTAMP",
  "tasks": {
    "$TASK_ID": {
      "id": "$TASK_ID",
      "name": "$TASK_NAME",
      "status": "$TASK_STATUS",
      "type": "$TASK_TYPE",
      "current_step": $CURRENT_STEP,
      "total_steps": $TOTAL_STEPS,
      "updated_at": "$TIMESTAMP",
      "reasoning_file": "$REASONING_FILE"
    }
  }
}
EOF
fi

# ==================== 生成全局索引 ====================

GLOBAL_INDEX="# 推理日志索引

> 最后更新: **${TIMESTAMP}**

---

## 活跃任务

"

if [ -f "$REASONING_META" ]; then
    ACTIVE_TASKS=$(jq -r '.tasks | to_entries[] | select(.value.status != "completed" and .value.status != "archived") | .key' "$REASONING_META" 2>/dev/null || echo "")

    if [ -n "$ACTIVE_TASKS" ]; then
        while read -r task_id; do
            if [ -n "$task_id" ]; then
                task_name=$(jq -r ".tasks[\"$task_id\"].name" "$REASONING_META")
                task_status=$(jq -r ".tasks[\"$task_id\"].status" "$REASONING_META")
                task_step=$(jq -r ".tasks[\"$task_id\"].current_step" "$REASONING_META")
                task_total=$(jq -r ".tasks[\"$task_id\"].total_steps" "$REASONING_META")
                task_file=$(jq -r ".tasks[\"$task_id\"].reasoning_file" "$REASONING_META")

                if [ "$task_total" -gt 0 ]; then
                    percent=$((task_step * 100 / task_total))
                    filled=$((task_step * 10 / task_total))
                    empty=$((10 - filled))
                    bar=""
                    for ((i=0; i<filled; i++)); do bar+="█"; done
                    for ((i=0; i<empty; i++)); do bar+="░"; done
                    progress="${bar} ${task_step}/${task_total} (${percent}%)"
                else
                    progress="准备中"
                fi

                GLOBAL_INDEX="${GLOBAL_INDEX}
### [${task_id}] ${task_name}

**状态**: \`${task_status^}\` | **进度**: \`${progress}\`

📄 **详细推理**: [\`${task_file}\`](${task_file})

"
            fi
        done <<< "$ACTIVE_TASKS"
    else
        GLOBAL_INDEX="${GLOBAL_INDEX}
*当前没有活跃任务*
"
    fi
else
    GLOBAL_INDEX="${GLOBAL_INDEX}
*暂无任务记录*
"
fi

GLOBAL_INDEX="${GLOBAL_INDEX}
---

## 说明

每个任务的推理日志独立存储在 \`results/k*/.reasoning.md\`，包含：
- 执行流程图（Mermaid）
- 进度条
- 推理详情
- 执行时间线

此文件为索引，点击上方链接查看详细推理日志。

---

## 命令

\`\`\`bash
# 查看全局索引
cat .info/.reasoning.md

# 查看特定任务推理
cat results/k01/.reasoning.md

# 查看任务元数据
cat .info/.reasoning.meta.json
\`\`\`
"

echo "$GLOBAL_INDEX" > "$REASONING_GLOBAL"

# 调试输出
echo -e "${BLUE}📝 推理日志已更新${NC}: ${TASK_ID} (${CURRENT_STEP}/${TOTAL_STEPS})" >&2

exit 0
