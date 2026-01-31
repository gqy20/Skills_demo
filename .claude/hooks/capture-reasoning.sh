#!/bin/bash
# PostToolUse Hook - 捕获推理块并维护推理日志
# 当写入 .reasoning.md 文件时触发
# 方案 A: 每个任务独立 + 全局索引

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

# 读取 hook 输入
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""' 2>/dev/null)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""' 2>/dev/null)
NEW_CONTENT=$(echo "$INPUT" | jq -r '.tool_input.content // ""' 2>/dev/null)

# 只处理 results/k*/.reasoning.md 文件
if [[ ! "$FILE_PATH" =~ results/k[0-9]+/\.reasoning\.md$ ]]; then
    exit 0
fi

# 确保目录存在
mkdir -p "$(dirname "$REASONING_GLOBAL")"
mkdir -p "$(dirname "$REASONING_META")"

# 提取任务 ID（从文件路径中提取 k01, k02 等）
TASK_ID=$(echo "$FILE_PATH" | grep -oE 'k[0-9]+' | head -1 || echo "")

if [ -z "$TASK_ID" ]; then
    exit 0
fi

# 获取当前时间戳
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
TIMESTAMP_ISO=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

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

    # 读取步骤数组（带重试机制，确保读取到最新数据）
    MAX_RETRIES=3
    RETRY_COUNT=0
    TOTAL_STEPS=0

    while [ $RETRY_COUNT -lt $MAX_RETRIES ] && [ "$TOTAL_STEPS" -eq 0 ]; do
        STEPS_JSON=$(json_read "$TASKS_FILE" ".tasks[\"$TASK_ID\"].steps // []" 2>/dev/null || echo "[]")
        TOTAL_STEPS=$(echo "$STEPS_JSON" | jq 'length' 2>/dev/null || echo "0")

        if [ "$TOTAL_STEPS" -eq 0 ] && [ $RETRY_COUNT -lt $((MAX_RETRIES - 1)) ]; then
            sleep 0.1
        fi
        RETRY_COUNT=$((RETRY_COUNT + 1))
    done

    # 将步骤转换为 bash 数组
    if [ "$TOTAL_STEPS" -gt 0 ]; then
        while IFS= read -r step; do
            STEPS_ARRAY+=("$step")
        done < <(echo "$STEPS_JSON" | jq -r '.[]' 2>/dev/null)
    fi
fi

# ==================== 读取推理内容 ====================

if [ -f "$FILE_PATH" ]; then
    # 尝试提取 <reasoning> 标签内的部分
    REASONING_CONTENT=$(sed -n '/<reasoning>/,/<\/reasoning>/p' "$FILE_PATH" 2>/dev/null || echo "")

    # 如果没有找到，使用空内容
    if [ -z "$REASONING_CONTENT" ]; then
        REASONING_CONTENT=""
    fi
else
    REASONING_CONTENT="$NEW_CONTENT"
fi

# 追加推理事件到日志
EVENT_JSON=$(jq -n \
    --arg task "$TASK_ID" \
    --arg time "$TIMESTAMP_ISO" \
    --arg time_readable "$TIMESTAMP" \
    --arg content "$REASONING_CONTENT" \
    '{"task": $task, "timestamp": $time, "timestamp_readable": $time_readable, "content": $content}')
echo "$EVENT_JSON" >> "$REASONING_TASK_LOG"

# ==================== Mermaid 格式验证 ====================

validate_mermaid_syntax() {
    local mermaid_code="$1"
    local errors=0
    local warnings=0

    # 1. 检查括号匹配
    local open_brackets=$(echo "$mermaid_code" | grep -o '\[' | wc -l)
    local close_brackets=$(echo "$mermaid_code" | grep -o '\]' | wc -l)

    if [ "$open_brackets" -ne "$close_brackets" ]; then
        echo -e "${RED}✗ Mermaid 错误: 括号不匹配 ([ $open_brackets vs ] $close_brackets)${NC}" >&2
        errors=$((errors + 1))
    fi

    # 2. 检查节点 ID 唯一性
    local node_ids=$(echo "$mermaid_code" | grep -oE 'S[0-9]+\[' | sort | uniq -d)
    if [ -n "$node_ids" ]; then
        echo -e "${YELLOW}⚠ Mermaid 警告: 可能重复的节点定义${NC}" >&2
        warnings=$((warnings + 1))
    fi

    # 3. 检查是否有非法字符（可能导致渲染失败）
    if echo "$mermaid_code" | grep -qE '\[\[^{}\]]*\]'; then
        echo -e "${YELLOW}⚠ Mermaid 警告: 节点名称中包含可能的特殊字符${NC}" >&2
        warnings=$((warnings + 1))
    fi

    # 4. 检查样式定义格式（支持 S1, S1_1, S1_LABEL 格式）
    local style_lines=$(echo "$mermaid_code" | grep -c '^    style ' || echo "0")
    if [ "$style_lines" -gt 0 ]; then
        # 检查样式行是否有正确的格式（支持一级、二级节点和标签节点）
        local invalid_styles=$(echo "$mermaid_code" | grep '^    style ' | grep -vE 'style S[0-9]+(_[0-9]+|_LABEL)? fill:')
        if [ -n "$invalid_styles" ]; then
            echo -e "${YELLOW}⚠ Mermaid 警告: 样式定义格式可能有问题${NC}" >&2
            warnings=$((warnings + 1))
        fi
    fi

    return $errors
}

# ==================== 清理步骤名称（移除特殊字符） ====================

sanitize_step_name() {
    local step_name="$1"
    local task_id="$2"

    # 去除任务 ID 前缀
    local cleaned="${step_name#$task_id}"
    cleaned="${cleaned#_}"

    # 转换为友好格式（首字母大写，去除下划线）
    cleaned=$(echo "$cleaned" | sed 's/_/ /g' | sed 's/\b\(.\)/\u\1/g')

    # 如果结果为空或太短，使用原始名称
    if [ -z "$cleaned" ] || [ ${#cleaned} -lt 2 ]; then
        cleaned="Step"
    fi

    echo "$cleaned"
}

# ==================== 获取步骤的方法论信息 ====================

extract_method_from_reasoning() {
    local reasoning="$1"
    local method=""
    local tool=""

    # 从推理块中提取方法
    method=$(echo "$reasoning" | grep -oP '🔍 方法：\K.*' | head -1 || echo "")
    # 从推理块中提取工具
    tool=$(echo "$reasoning" | grep -oP '🔧 工具：\K.*' | head -1 || echo "")

    # 如果没有找到，尝试其他模式
    if [ -z "$method" ]; then
        method=$(echo "$reasoning" | grep -oP '方法[:：]\K.*' | head -1 | sed 's/\n.*//' || echo "")
    fi

    echo "$method|$tool"
}

# ==================== 推断步骤类型和方法标签 ====================

infer_step_info() {
    local step_name="$1"
    local method=""
    local tool=""
    local emoji="📋"

    # 根据步骤名称推断类型和方法
    case "$step_name" in
        *init*|*setup*|*create*)
            emoji="🏗️"
            method="初始化"
            tool="脚手架工具"
            ;;
        *config*|*setup*)
            emoji="⚙️"
            method="配置"
            tool="配置文件"
            ;;
        *research*|*analyze*|*study*)
            emoji="🔬"
            method="研究分析"
            tool="分析工具"
            ;;
        *design*|*architect*)
            emoji="🎨"
            method="设计"
            tool="设计工具"
            ;;
        *implement*|*develop*|*build*)
            emoji="💻"
            method="开发"
            tool="编程语言"
            ;;
        *test*|*verify*)
            emoji="✅"
            method="测试验证"
            tool="测试框架"
            ;;
        *deploy*|*release*)
            emoji="🚀"
            method="部署"
            tool="部署工具"
            ;;
        *document*|*write*)
            emoji="📝"
            method="文档编写"
            tool="文档工具"
            ;;
        *)
            emoji="📋"
            method="执行"
            tool="通用工具"
            ;;
    esac

    echo "${emoji}|${method}|${tool}"
}

# ==================== 生成 Mermaid 流程图（增强版，支持二级子任务） ====================

generate_mermaid_flowchart() {
    local current=$1
    local total=$2
    local reasoning_content="$3"
    shift 3
    local steps=("$@")

    echo '```mermaid'
    echo 'flowchart LR'

    # 检查是否有子任务结构（从 tasks.json 读取）
    local has_subtasks=false
    local step_subtasks=()

    if [ -f "$TASKS_FILE" ]; then
        # 尝试读取子任务数据
        for i in "${!steps[@]}"; do
            local step_name="${steps[$i]}"
            local subtask_data=$(json_read "$TASKS_FILE" ".tasks[\"$TASK_ID\"].step_details[\"$step_name\"].subtasks // []" 2>/dev/null || echo "[]")
            local subtask_count=$(echo "$subtask_data" | jq 'length' 2>/dev/null || echo "0")

            if [ "$subtask_count" -gt 0 ]; then
                has_subtasks=true
                step_subtasks[$i]="$subtask_data"
            else
                step_subtasks[$i]="[]"
            fi
        done
    fi

    # 根据是否有子任务选择不同的生成逻辑
    if [ "$has_subtasks" = true ]; then
        # ========== 带子任务的嵌套结构 ==========
        for i in "${!steps[@]}"; do
            local step_name="${steps[$i]}"
            local step_num=$((i + 1))
            local node_id="S${step_num}"
            local subtasks_data="${step_subtasks[$i]}"
            local subtask_count=$(echo "$subtasks_data" | jq 'length' 2>/dev/null || echo "0")

            # 清理步骤名称
            local display_name=$(sanitize_step_name "$step_name" "$TASK_ID")

            # 获取步骤信息
            local step_info=$(infer_step_info "$step_name")
            local step_emoji=$(echo "$step_info" | cut -d'|' -f1)
            local step_method=$(echo "$step_info" | cut -d'|' -f2)

            # 如果是当前步骤，使用推理块中的方法
            if [ $i -eq $current ] && [ -n "$reasoning_content" ]; then
                local extracted=$(extract_method_from_reasoning "$reasoning_content")
                local extracted_method=$(echo "$extracted" | cut -d'|' -f1)
                if [ -n "$extracted_method" ]; then
                    step_method="$extracted_method"
                fi
            fi

            # 限制方法标签长度
            local method_label="$step_method"
            if [ ${#method_label} -gt 10 ]; then
                method_label="${method_label:0:10}..."
            fi

            # 如果有子任务，使用 subgraph（外部标签避免覆盖）
            if [ "$subtask_count" -gt 0 ]; then
                # 创建外部标签节点（不会被覆盖）
                echo "    ${node_id}_LABEL[\"${step_emoji} ${display_name}<br/><small>【${method_label}】</small>\"]"

                # 创建空标题的 subgraph
                echo "    subgraph ${node_id}"
                echo "        direction TB"

                # 生成子任务节点
                local prev_subnode=""
                for j in $(seq 0 $((subtask_count - 1))); do
                    local subtask_name=$(echo "$subtasks_data" | jq -r ".[$j].name // \"子任务$((j+1))\"" 2>/dev/null)
                    local subtask_status=$(echo "$subtasks_data" | jq -r ".[$j].status // \"pending\"" 2>/dev/null)
                    local subnode_id="${node_id}_$((j + 1))"

                    echo "        ${subnode_id}[\"${subtask_name}\"]"

                    # 连接子任务
                    if [ -n "$prev_subnode" ]; then
                        echo "        ${prev_subnode} --> ${subnode_id}"
                    fi

                    prev_subnode="$subnode_id"
                done

                echo "    end"

                # 虚线连接标签到第一个子任务
                local first_subnode="${node_id}_1"
                echo "    ${node_id}_LABEL -.-> ${first_subnode}"
            else
                # 没有子任务，使用普通节点
                echo "    ${node_id}[\"${step_emoji} 步骤${step_num}: ${display_name}<br/><small>[${method_label}]</small>\"]"
            fi

            # 生成步骤间连接（除最后一步）
            if [ $i -lt $((${total} - 1)) ]; then
                local next_node="S$((step_num + 1))"
                # 对于有子任务的步骤，连接从标签节点发出
                if [ "$subtask_count" -gt 0 ]; then
                    echo "    ${node_id}_LABEL --> ${next_node}_LABEL"
                else
                    echo "    ${node_id} --> ${next_node}"
                fi
            fi
        done
    else
        # ========== 原有的线性结构 ==========
        for i in "${!steps[@]}"; do
            local step_name="${steps[$i]}"
            local step_num=$((i + 1))
            local node_id="S${step_num}"

            # 清理步骤名称
            local display_name=$(sanitize_step_name "$step_name" "$TASK_ID")

            # 获取步骤信息（推断）
            local step_info=$(infer_step_info "$step_name")
            local step_emoji=$(echo "$step_info" | cut -d'|' -f1)
            local step_method=$(echo "$step_info" | cut -d'|' -f2)

            # 只有当前步骤才使用推理块中的具体方法信息
            if [ $i -eq $current ] && [ -n "$reasoning_content" ]; then
                local extracted=$(extract_method_from_reasoning "$reasoning_content")
                local extracted_method=$(echo "$extracted" | cut -d'|' -f1)
                if [ -n "$extracted_method" ]; then
                    step_method="$extracted_method"
                fi
            fi

            # 生成节点定义（增强版，包含方法标签）
            local method_label="$step_method"
            if [ ${#method_label} -gt 12 ]; then
                method_label="${method_label:0:12}..."
            fi

            echo "    ${node_id}[\"${step_emoji} 步骤${step_num}: ${display_name}<br/><small>[${method_label}]</small>\"]"

            # 生成连接（除最后一步）
            if [ $i -lt $((${total} - 1)) ]; then
                local next_node="S$((step_num + 1))"
                echo "    ${node_id} --> ${next_node}"
            fi
        done
    fi

    echo ""

    # ========== 样式定义 ==========
    # 已完成步骤（绿色）
    if [ $current -gt 0 ]; then
        for i in $(seq 0 $((current - 1))); do
            local step_num=$((i + 1))
            local subtasks_data="${step_subtasks[$i]}"
            local subtask_count=$(echo "$subtasks_data" | jq 'length' 2>/dev/null || echo "0")

            if [ "$subtask_count" -gt 0 ] && [ "$has_subtasks" = true ]; then
                # 有子任务时，给标签节点和所有子任务节点添加样式
                echo "    style S${step_num}_LABEL fill:#90EE90,stroke:#333,stroke-width:2px"
                for j in $(seq 1 $subtask_count); do
                    echo "    style S${step_num}_${j} fill:#e8f5e8,stroke:#333,stroke-width:1px"
                done
            else
                echo "    style S${step_num} fill:#90EE90,stroke:#333,stroke-width:2px"
            fi
        done
    fi

    # 当前步骤（黄色）
    if [ $current -ge 0 ] && [ $current -lt $total ]; then
        local step_num=$((current + 1))
        local subtasks_data="${step_subtasks[$current]}"
        local subtask_count=$(echo "$subtasks_data" | jq 'length' 2>/dev/null || echo "0")

        if [ "$subtask_count" -gt 0 ] && [ "$has_subtasks" = true ]; then
            echo "    style S${step_num}_LABEL fill:#FFD700,stroke:#333,stroke-width:3px"
            for j in $(seq 1 $subtask_count); do
                echo "    style S${step_num}_${j} fill:#fff4cc,stroke:#333,stroke-width:2px"
            done
        else
            echo "    style S${step_num} fill:#FFD700,stroke:#333,stroke-width:3px"
        fi
    fi

    # 待执行步骤（灰色）
    if [ $((current + 2)) -le $total ]; then
        for i in $(seq $((current + 1)) $((total - 1))); do
            local step_num=$((i + 1))
            local subtasks_data="${step_subtasks[$i]}"
            local subtask_count=$(echo "$subtasks_data" | jq 'length' 2>/dev/null || echo "0")

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

# ==================== 生成步骤说明表（作为 Mermaid 的补充） ====================

generate_step_table() {
    local current=$1
    local total=$2
    local reasoning_content="$3"
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
        local cleaned=$(sanitize_step_name "$step_name" "$TASK_ID")

        # 获取步骤信息（推断）
        local step_info=$(infer_step_info "$step_name")
        local step_method=$(echo "$step_info" | cut -d'|' -f2)
        local step_tool=$(echo "$step_info" | cut -d'|' -f3)

        # 只有当前步骤才使用推理块中的具体信息
        if [ $i -eq $current ] && [ -n "$reasoning_content" ]; then
            local extracted=$(extract_method_from_reasoning "$reasoning_content")
            local extracted_method=$(echo "$extracted" | cut -d'|' -f1)
            local extracted_tool=$(echo "$extracted" | cut -d'|' -f2)

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

# ==================== 格式化推理详情（Callout 样式） ====================

format_reasoning_details() {
    local reasoning_content="$1"

    # 如果没有推理内容，返回空
    if [ -z "$reasoning_content" ]; then
        echo ""
        return
    fi

    # 提取所有 reasoning 块
    local reasoning_blocks=""
    local in_block=false
    local block_content=""
    local block_count=0

    while IFS= read -r line; do
        if [[ "$line" =~ ^\<reasoning\> ]]; then
            in_block=true
            block_content=""
        elif [[ "$line" =~ ^\</reasoning\> ]]; then
            in_block=false
            if [ -n "$block_content" ]; then
                block_count=$((block_count + 1))
                reasoning_blocks="${reasoning_blocks}### 步骤 ${block_count}

"
                # 解析块内容
                local goal=$(echo "$block_content" | grep -oP '🎯 目标：\K.*' | head -1 || echo "")
                local method=$(echo "$block_content" | grep -oP '🔍 方法：\K.*' | head -1 || echo "")
                local decision=$(echo "$block_content" | grep -oP '✅ 决策：\K.*' | head -1 || echo "")

                # 提取发现内容并格式化为列表
                local findings=$(echo "$block_content" | sed -n '/💡 发现：/,/✅ 决策：/p' | sed '1d;$d' | sed 's/^[[:space:]]*- //' | grep -v '^$' || echo "")
                local findings_formatted=""
                if [ -n "$findings" ]; then
                    while IFS= read -r finding_line; do
                        if [ -n "$finding_line" ]; then
                            findings_formatted="${findings_formatted}> - ${finding_line}"$'\n'
                        fi
                    done <<< "$findings"
                fi

                # 生成简化格式（无 emoji，兼容所有 Markdown 渲染器）
                reasoning_blocks="${reasoning_blocks}> **目标**: ${goal:-未明确}
>
> **方法**: ${method:-未明确}
>
> **发现**:
${findings_formatted:-> 无详细发现}
> **决策**: ${decision:-未明确}
>
---
"
            fi
        elif [ "$in_block" = true ]; then
            block_content="${block_content}${line}"$'\n'
        fi
    done <<< "$reasoning_content"

    # 如果没有找到 reasoning 块，返回原始内容（保留原有格式）
    if [ "$block_count" -eq 0 ]; then
        echo '```'
        echo "$reasoning_content"
        echo '```'
    else
        echo "$reasoning_blocks"
    fi
}

# ==================== 生成时间线 ====================

generate_timeline() {
    echo '```mermaid'
    echo 'timeline'
    # 使用简化的日期格式 (YYYY-MM-DD)
    local date_only=$(date '+%Y-%m-%d')
    local current_time=$(date '+%H:%M')

    # 读取该任务的最近事件（最多5条）
    if [ -f "$REASONING_TASK_LOG" ]; then
        grep "\"task\": \"${TASK_ID}\"" "$REASONING_TASK_LOG" | tail -3 | \
            jq -r '.timestamp_readable' 2>/dev/null | \
            while read -r line; do
                if [ -n "$line" ]; then
                    # 提取日期时间
                    local event_date=$(echo "$line" | cut -d' ' -f1)
                    local event_time=$(echo "$line" | cut -d' ' -f2)
                    echo "    $event_date : $event_time 历史更新"
                fi
            done
    fi

    echo '```'
}

# ==================== 生成任务级推理日志 ====================

# 生成各部分内容
MERMAID_CHART=$(generate_mermaid_flowchart $CURRENT_STEP $TOTAL_STEPS "$REASONING_CONTENT" "${STEPS_ARRAY[@]}")
STEP_TABLE=$(generate_step_table $CURRENT_STEP $TOTAL_STEPS "$REASONING_CONTENT" "${STEPS_ARRAY[@]}")
PROGRESS_BAR=$(generate_progress_bar $CURRENT_STEP $TOTAL_STEPS)
TIMELINE_CHART=$(generate_timeline)
REASONING_DETAILS=$(format_reasoning_details "$REASONING_CONTENT")

# 验证 Mermaid 语法
MERMAID_CODE=$(echo "$MERMAID_CHART" | sed '1d;$d')  # 去掉 ``` 标记
if ! validate_mermaid_syntax "$MERMAID_CODE"; then
    echo -e "${YELLOW}⚠ Mermaid 图可能存在渲染问题，已生成步骤详情表作为备选${NC}" >&2
fi

# 获取当前步骤名称
if [ $CURRENT_STEP -lt $TOTAL_STEPS ] && [ $TOTAL_STEPS -gt 0 ]; then
    CURRENT_STEP_NAME="${STEPS_ARRAY[$CURRENT_STEP]}"
    CURRENT_STEP_NAME="${CURRENT_STEP_NAME#$TASK_ID}"
    CURRENT_STEP_NAME="${CURRENT_STEP_NAME#_}"
    CURRENT_STEP_NAME="${CURRENT_STEP_NAME^}"
else
    CURRENT_STEP_NAME="已完成"
fi

# 生成状态 emoji（可选，用于头部）
get_status_emoji() {
    local status="$1"
    case "$status" in
        completed|done|✅) echo "✅" ;;
        active|in_progress|🔄) echo "🔄" ;;
        pending|⏳) echo "⏳" ;;
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

# 写入任务级推理日志（覆盖原文件，保持最新状态）
echo "$TASK_CONTENT" > "$FILE_PATH"

# ==================== 更新任务元数据 ====================

# 更新或创建任务元数据
if [ -f "$REASONING_META" ]; then
    # 更新现有任务
    temp_meta=$(jq --arg id "$TASK_ID" \
        --arg name "$TASK_NAME" \
        --arg status "$TASK_STATUS" \
        --arg type "$TASK_TYPE" \
        --argjson step "$CURRENT_STEP" \
        --argjson total "$TOTAL_STEPS" \
        --arg time "$TIMESTAMP" \
        --arg file "$FILE_PATH" \
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
    # 创建新的元数据文件
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
      "reasoning_file": "$FILE_PATH"
    }
  }
}
EOF
fi

# ==================== 生成全局索引 ====================

# 读取所有任务元数据并生成全局索引
GLOBAL_INDEX="# 推理日志索引

> 最后更新: **${TIMESTAMP}**

---

## 活跃任务

"

# 添加活跃任务列表
if [ -f "$REASONING_META" ]; then
    # 获取所有非 completed 状态的任务
    ACTIVE_TASKS=$(jq -r '.tasks | to_entries[] | select(.value.status != "completed" and .value.status != "archived") | .key' "$REASONING_META" 2>/dev/null || echo "")

    if [ -n "$ACTIVE_TASKS" ]; then
        while read -r task_id; do
            if [ -n "$task_id" ]; then
                task_name=$(jq -r ".tasks[\"$task_id\"].name" "$REASONING_META")
                task_status=$(jq -r ".tasks[\"$task_id\"].status" "$REASONING_META")
                task_step=$(jq -r ".tasks[\"$task_id\"].current_step" "$REASONING_META")
                task_total=$(jq -r ".tasks[\"$task_id\"].total_steps" "$REASONING_META")
                task_file=$(jq -r ".tasks[\"$task_id\"].reasoning_file" "$REASONING_META")

                # 生成进度条
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

# 写入全局索引
echo "$GLOBAL_INDEX" > "$REASONING_GLOBAL"

# 调试输出
echo -e "${BLUE}📝 推理日志已更新${NC}: ${TASK_ID} (${CURRENT_STEP}/${TOTAL_STEPS})" >&2

exit 0
