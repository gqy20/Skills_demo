#!/bin/bash
# Shared I/O utilities for reasoning hooks.

load_task_context() {
    local task_id="$1"
    local tasks_file="$2"

    TASK_NAME="未知任务"
    TASK_STATUS="unknown"
    TASK_TYPE="general"
    CURRENT_STEP=0
    STEPS_ARRAY=()
    TOTAL_STEPS=0

    if [ ! -f "$tasks_file" ]; then
        return 0
    fi

    TASK_NAME=$(json_read "$tasks_file" ".tasks[\"$task_id\"].name // \"$task_id 任务\"" 2>/dev/null || echo "$task_id 任务")
    TASK_STATUS=$(json_read "$tasks_file" ".tasks[\"$task_id\"].status // \"unknown\"" 2>/dev/null || echo "unknown")
    TASK_TYPE=$(json_read "$tasks_file" ".tasks[\"$task_id\"].type // \"general\"" 2>/dev/null || echo "general")
    CURRENT_STEP=$(json_read "$tasks_file" ".tasks[\"$task_id\"].current_step // 0" 2>/dev/null || echo "0")

    local max_retries=3
    local retry_count=0
    local steps_json="[]"

    while [ $retry_count -lt $max_retries ] && [ "$TOTAL_STEPS" -eq 0 ]; do
        steps_json=$(json_read "$tasks_file" ".tasks[\"$task_id\"].steps // []" 2>/dev/null || echo "[]")
        TOTAL_STEPS=$(echo "$steps_json" | jq 'length' 2>/dev/null || echo "0")

        if [ "$TOTAL_STEPS" -eq 0 ] && [ $retry_count -lt $((max_retries - 1)) ]; then
            sleep 0.1
        fi
        retry_count=$((retry_count + 1))
    done

    if [ "$TOTAL_STEPS" -gt 0 ]; then
        while IFS= read -r step; do
            STEPS_ARRAY+=("$step")
        done < <(echo "$steps_json" | jq -r '.[]' 2>/dev/null)
    fi

    return 0
}

recover_reasoning_from_log() {
    local task_id="$1"
    local log_file="$2"

    if [ ! -f "$log_file" ]; then
        echo ""
        return
    fi

    local last_content
    last_content=$(jq -s -r \
        "[.[] | select(.task == \"$task_id\" and (.content // \"\" | length) > 0)] | .[-1].content // \"\"" \
        "$log_file" 2>/dev/null)

    echo "$last_content"
}

extract_reasoning_from_file() {
    local file_path="$1"
    if [ ! -f "$file_path" ]; then
        echo ""
        return
    fi
    sed -n '/<reasoning>/,/<\/reasoning>/p' "$file_path" 2>/dev/null || echo ""
}

resolve_reasoning_content() {
    local new_content="$1"
    local file_path="$2"
    local task_id="$3"
    local log_file="$4"

    if [ -n "$new_content" ]; then
        echo "$new_content"
        return
    fi

    local extracted
    extracted=$(extract_reasoning_from_file "$file_path")
    if [ -n "$extracted" ]; then
        echo "$extracted"
        return
    fi

    recover_reasoning_from_log "$task_id" "$log_file"
}

append_reasoning_event() {
    local task_id="$1"
    local timestamp_iso="$2"
    local timestamp_readable="$3"
    local content="$4"
    local log_file="$5"

    local event_json
    event_json=$(jq -n \
        --arg task "$task_id" \
        --arg time "$timestamp_iso" \
        --arg time_readable "$timestamp_readable" \
        --arg content "$content" \
        '{"task": $task, "timestamp": $time, "timestamp_readable": $time_readable, "content": $content}')
    echo "$event_json" >> "$log_file"
}

build_current_step_name() {
    local current_step="$1"
    local total_steps="$2"
    local task_id="$3"
    shift 3
    local steps=("$@")

    if [ "$current_step" -lt "$total_steps" ] && [ "$total_steps" -gt 0 ]; then
        local current_step_name="${steps[$current_step]}"
        current_step_name="${current_step_name#$task_id}"
        current_step_name="${current_step_name#_}"
        echo "${current_step_name^}"
    else
        echo "已完成"
    fi
}

update_reasoning_meta() {
    local meta_file="$1"
    local task_id="$2"
    local task_name="$3"
    local task_status="$4"
    local task_type="$5"
    local current_step="$6"
    local total_steps="$7"
    local timestamp="$8"
    local reasoning_file="$9"

    if [ -f "$meta_file" ]; then
        local temp_meta
        temp_meta=$(jq --arg id "$task_id" \
            --arg name "$task_name" \
            --arg status "$task_status" \
            --arg type "$task_type" \
            --argjson step "$current_step" \
            --argjson total "$total_steps" \
            --arg time "$timestamp" \
            --arg file "$reasoning_file" \
            '.tasks[$id] = {
                "id": $id,
                "name": $name,
                "status": $status,
                "type": $type,
                "current_step": $step,
                "total_steps": $total,
                "updated_at": $time,
                "reasoning_file": $file
            }' "$meta_file")
        echo "$temp_meta" > "$meta_file"
    else
        cat > "$meta_file" <<EOF_META
{
  "updated_at": "$timestamp",
  "tasks": {
    "$task_id": {
      "id": "$task_id",
      "name": "$task_name",
      "status": "$task_status",
      "type": "$task_type",
      "current_step": $current_step,
      "total_steps": $total_steps,
      "updated_at": "$timestamp",
      "reasoning_file": "$reasoning_file"
    }
  }
}
EOF_META
    fi
}

generate_global_reasoning_index() {
    local meta_file="$1"
    local timestamp="$2"

    local global_index="# 推理日志索引

> 最后更新: **${timestamp}**

---

## 活跃任务

"

    if [ -f "$meta_file" ]; then
        local active_tasks
        active_tasks=$(jq -r '.tasks | to_entries[] | select(.value.status != "completed" and .value.status != "archived") | .key' "$meta_file" 2>/dev/null || echo "")

        if [ -n "$active_tasks" ]; then
            while read -r task_id; do
                if [ -z "$task_id" ]; then
                    continue
                fi
                local task_name
                task_name=$(jq -r ".tasks[\"$task_id\"].name" "$meta_file")
                local task_status
                task_status=$(jq -r ".tasks[\"$task_id\"].status" "$meta_file")
                local task_step
                task_step=$(jq -r ".tasks[\"$task_id\"].current_step" "$meta_file")
                local task_total
                task_total=$(jq -r ".tasks[\"$task_id\"].total_steps" "$meta_file")
                local task_file
                task_file=$(jq -r ".tasks[\"$task_id\"].reasoning_file" "$meta_file")

                local progress="准备中"
                if [ "$task_total" -gt 0 ]; then
                    local percent=$((task_step * 100 / task_total))
                    local filled=$((task_step * 10 / task_total))
                    local empty=$((10 - filled))
                    local bar=""
                    for ((i = 0; i < filled; i++)); do bar+="█"; done
                    for ((i = 0; i < empty; i++)); do bar+="░"; done
                    progress="${bar} ${task_step}/${task_total} (${percent}%)"
                fi

                global_index="${global_index}
### [${task_id}] ${task_name}

**状态**: \`${task_status^}\` | **进度**: \`${progress}\`

📄 **详细推理**: [\`${task_file}\`](${task_file})

"
            done <<< "$active_tasks"
        else
            global_index="${global_index}
*当前没有活跃任务*
"
        fi
    else
        global_index="${global_index}
*暂无任务记录*
"
    fi

    global_index="${global_index}
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

    echo "$global_index"
}
