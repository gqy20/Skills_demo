#!/bin/bash
# Mermaid-specific rendering utilities for reasoning hooks.

generate_mermaid_flowchart() {
    local current=$1
    local total=$2
    local reasoning_content="$3"
    local tasks_file="$4"
    local task_id="$5"
    shift 5
    local steps=("$@")

    echo '```mermaid'
    echo 'flowchart LR'

    local has_subtasks=false
    local step_subtasks=()

    if [ -f "$tasks_file" ]; then
        for i in "${!steps[@]}"; do
            local step_name="${steps[$i]}"
            local subtask_data
            subtask_data=$(json_read "$tasks_file" ".tasks[\"$task_id\"].step_details[\"$step_name\"].subtasks // []" 2>/dev/null || echo "[]")
            local subtask_count
            subtask_count=$(echo "$subtask_data" | jq 'length' 2>/dev/null || echo "0")

            if [ "$subtask_count" -gt 0 ]; then
                has_subtasks=true
                step_subtasks[$i]="$subtask_data"
            else
                step_subtasks[$i]="[]"
            fi
        done
    fi

    if [ "$has_subtasks" = true ]; then
        for i in "${!steps[@]}"; do
            local step_name="${steps[$i]}"
            local step_num=$((i + 1))
            local node_id="S${step_num}"
            local subtasks_data="${step_subtasks[$i]}"
            local subtask_count
            subtask_count=$(echo "$subtasks_data" | jq 'length' 2>/dev/null || echo "0")

            local display_name
            display_name=$(sanitize_step_name "$step_name" "$task_id")

            local step_info
            step_info=$(infer_step_info "$step_name")
            local step_emoji
            step_emoji=$(echo "$step_info" | cut -d'|' -f1)
            local step_method
            step_method=$(echo "$step_info" | cut -d'|' -f2)

            if [ $i -eq $current ] && [ -n "$reasoning_content" ]; then
                local extracted
                extracted=$(extract_method_from_reasoning "$reasoning_content")
                local extracted_method
                extracted_method=$(echo "$extracted" | cut -d'|' -f1)
                if [ -n "$extracted_method" ]; then
                    step_method="$extracted_method"
                fi
            fi

            local method_label="$step_method"
            if [ ${#method_label} -gt 10 ]; then
                method_label="${method_label:0:10}..."
            fi

            if [ "$subtask_count" -gt 0 ]; then
                echo "    ${node_id}_LABEL[\"${step_emoji} ${display_name}<br/><small>【${method_label}】</small>\"]"
                echo "    subgraph ${node_id}"
                echo "        direction TB"

                local prev_subnode=""
                for j in $(seq 0 $((subtask_count - 1))); do
                    local subtask_name
                    subtask_name=$(echo "$subtasks_data" | jq -r ".[$j].name // \"子任务$((j + 1))\"" 2>/dev/null)
                    local subnode_id="${node_id}_$((j + 1))"

                    echo "        ${subnode_id}[\"${subtask_name}\"]"
                    if [ -n "$prev_subnode" ]; then
                        echo "        ${prev_subnode} --> ${subnode_id}"
                    fi
                    prev_subnode="$subnode_id"
                done

                echo "    end"
                local first_subnode="${node_id}_1"
                echo "    ${node_id}_LABEL -.-> ${first_subnode}"
            else
                echo "    ${node_id}[\"${step_emoji} 步骤${step_num}: ${display_name}<br/><small>[${method_label}]</small>\"]"
            fi

            if [ $i -lt $((total - 1)) ]; then
                local next_node="S$((step_num + 1))"
                if [ "$subtask_count" -gt 0 ]; then
                    echo "    ${node_id}_LABEL --> ${next_node}_LABEL"
                else
                    echo "    ${node_id} --> ${next_node}"
                fi
            fi
        done
    else
        for i in "${!steps[@]}"; do
            local step_name="${steps[$i]}"
            local step_num=$((i + 1))
            local node_id="S${step_num}"

            local display_name
            display_name=$(sanitize_step_name "$step_name" "$task_id")

            local step_info
            step_info=$(infer_step_info "$step_name")
            local step_emoji
            step_emoji=$(echo "$step_info" | cut -d'|' -f1)
            local step_method
            step_method=$(echo "$step_info" | cut -d'|' -f2)

            if [ $i -eq $current ] && [ -n "$reasoning_content" ]; then
                local extracted
                extracted=$(extract_method_from_reasoning "$reasoning_content")
                local extracted_method
                extracted_method=$(echo "$extracted" | cut -d'|' -f1)
                if [ -n "$extracted_method" ]; then
                    step_method="$extracted_method"
                fi
            fi

            local method_label="$step_method"
            if [ ${#method_label} -gt 12 ]; then
                method_label="${method_label:0:12}..."
            fi

            echo "    ${node_id}[\"${step_emoji} 步骤${step_num}: ${display_name}<br/><small>[${method_label}]</small>\"]"

            if [ $i -lt $((total - 1)) ]; then
                local next_node="S$((step_num + 1))"
                echo "    ${node_id} --> ${next_node}"
            fi
        done
    fi

    echo ""

    if [ $current -gt 0 ]; then
        for i in $(seq 0 $((current - 1))); do
            local step_num=$((i + 1))
            local subtasks_data="${step_subtasks[$i]}"
            local subtask_count
            subtask_count=$(echo "$subtasks_data" | jq 'length' 2>/dev/null || echo "0")

            if [ "$subtask_count" -gt 0 ] && [ "$has_subtasks" = true ]; then
                echo "    style S${step_num}_LABEL fill:#90EE90,stroke:#333,stroke-width:2px"
                for j in $(seq 1 $subtask_count); do
                    echo "    style S${step_num}_${j} fill:#e8f5e8,stroke:#333,stroke-width:1px"
                done
            else
                echo "    style S${step_num} fill:#90EE90,stroke:#333,stroke-width:2px"
            fi
        done
    fi

    if [ $current -ge 0 ] && [ $current -lt $total ]; then
        local step_num=$((current + 1))
        local subtasks_data="${step_subtasks[$current]}"
        local subtask_count
        subtask_count=$(echo "$subtasks_data" | jq 'length' 2>/dev/null || echo "0")

        if [ "$subtask_count" -gt 0 ] && [ "$has_subtasks" = true ]; then
            echo "    style S${step_num}_LABEL fill:#FFD700,stroke:#333,stroke-width:3px"
            for j in $(seq 1 $subtask_count); do
                echo "    style S${step_num}_${j} fill:#fff4cc,stroke:#333,stroke-width:2px"
            done
        else
            echo "    style S${step_num} fill:#FFD700,stroke:#333,stroke-width:3px"
        fi
    fi

    if [ $((current + 2)) -le $total ]; then
        for i in $(seq $((current + 1)) $((total - 1))); do
            local step_num=$((i + 1))
            local subtasks_data="${step_subtasks[$i]}"
            local subtask_count
            subtask_count=$(echo "$subtasks_data" | jq 'length' 2>/dev/null || echo "0")

            if [ "$subtask_count" -gt 0 ] && [ "$has_subtasks" = true ]; then
                echo "    style S${step_num}_LABEL fill:#f0f0f0,stroke:#999,stroke-width:2px"
                for j in $(seq 1 $subtask_count); do
                    echo "    style S${step_num}_${j} fill:#fafafa,stroke:#999,stroke-width:1px"
                done
            else
                echo "    style S${step_num} fill:#f0f0f0,stroke:#999,stroke-width:1px"
            fi
        done
    fi

    echo '```'
}

generate_step_table() {
    local current=$1
    local reasoning_content="$2"
    local task_id="$3"
    shift 3
    local steps=("$@")

    echo ""
    echo "**步骤详情与方法论**："
    echo ""
    echo "| 步骤 | 技能名称 | 状态 | 方法 | 工具 |"
    echo "|:----:|---------|:----:|------|------|"

    for i in "${!steps[@]}"; do
        local step_name="${steps[$i]}"
        local step_num=$((i + 1))

        local step_info
        step_info=$(infer_step_info "$step_name")
        local step_method
        step_method=$(echo "$step_info" | cut -d'|' -f2)
        local step_tool
        step_tool=$(echo "$step_info" | cut -d'|' -f3)

        if [ $i -eq $current ] && [ -n "$reasoning_content" ]; then
            local extracted
            extracted=$(extract_method_from_reasoning "$reasoning_content")
            local extracted_method
            extracted_method=$(echo "$extracted" | cut -d'|' -f1)
            local extracted_tool
            extracted_tool=$(echo "$extracted" | cut -d'|' -f2)

            if [ -n "$extracted_method" ]; then
                step_method="$extracted_method"
            fi
            if [ -n "$extracted_tool" ]; then
                step_tool="$extracted_tool"
            fi
        fi

        local status=""
        if [ $i -lt $current ]; then
            status="✅ 完成"
        elif [ $i -eq $current ]; then
            status="🔄 进行中"
        else
            status="⏳ 待执行"
        fi

        echo "| ${step_num} | \`${step_name}\` | ${status} | ${step_method} | ${step_tool} |"
    done

    echo ""
}
