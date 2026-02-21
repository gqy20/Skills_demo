#!/bin/bash
# Shared non-mermaid rendering utilities for reasoning hooks.

sanitize_step_name() {
    local step_name="$1"
    local task_id="$2"

    local cleaned="${step_name#$task_id}"
    cleaned="${cleaned#_}"
    cleaned=$(echo "$cleaned" | sed 's/_/ /g' | sed 's/\b\(.\)/\u\1/g')

    if [ -z "$cleaned" ] || [ ${#cleaned} -lt 2 ]; then
        cleaned="Step"
    fi

    echo "$cleaned"
}

extract_method_from_reasoning() {
    local reasoning="$1"
    local method=""
    local tool=""

    method=$(echo "$reasoning" | grep -oP '🔍 方法：\K.*' | head -1 || echo "")
    tool=$(echo "$reasoning" | grep -oP '🔧 工具：\K.*' | head -1 || echo "")

    if [ -z "$method" ]; then
        method=$(echo "$reasoning" | grep -oP '方法[:：]\K.*' | head -1 | sed 's/\n.*//' || echo "")
    fi

    echo "$method|$tool"
}

infer_step_info() {
    local step_name="$1"
    local method=""
    local tool=""
    local emoji="📋"

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

validate_mermaid_syntax() {
    local mermaid_code="$1"
    local errors=0

    local open_brackets
    open_brackets=$(echo "$mermaid_code" | grep -o '\[' | wc -l)
    local close_brackets
    close_brackets=$(echo "$mermaid_code" | grep -o '\]' | wc -l)

    if [ "$open_brackets" -ne "$close_brackets" ]; then
        echo -e "${RED}✗ Mermaid 错误: 括号不匹配 ([ $open_brackets vs ] $close_brackets)${NC}" >&2
        errors=$((errors + 1))
    fi

    local node_ids
    node_ids=$(echo "$mermaid_code" | grep -oE 'S[0-9]+\[' | sort | uniq -d)
    if [ -n "$node_ids" ]; then
        echo -e "${YELLOW}⚠ Mermaid 警告: 可能重复的节点定义${NC}" >&2
    fi

    if echo "$mermaid_code" | grep -qE '\[\[^{}\]]*\]'; then
        echo -e "${YELLOW}⚠ Mermaid 警告: 节点名称中包含可能的特殊字符${NC}" >&2
    fi

    local style_lines
    style_lines=$(echo "$mermaid_code" | grep -c '^    style ' || echo "0")
    if [ "$style_lines" -gt 0 ]; then
        local invalid_styles
        invalid_styles=$(echo "$mermaid_code" | grep '^    style ' | grep -vE 'style S[0-9]+(_[0-9]+|_LABEL)? fill:')
        if [ -n "$invalid_styles" ]; then
            echo -e "${YELLOW}⚠ Mermaid 警告: 样式定义格式可能有问题${NC}" >&2
        fi
    fi

    return $errors
}

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
    for ((i = 0; i < filled; i++)); do bar+="█"; done
    for ((i = 0; i < empty; i++)); do bar+="░"; done

    echo "**进度**: \`${bar}\` ${current}/${total} (${percent}%)"
}

format_reasoning_details() {
    local reasoning_content="$1"

    if [ -z "$reasoning_content" ]; then
        echo ""
        return
    fi

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

                local goal
                goal=$(echo "$block_content" | grep -oP '🎯 目标：\K.*' | head -1 || echo "")
                local method
                method=$(echo "$block_content" | grep -oP '🔍 方法：\K.*' | head -1 || echo "")
                local decision
                decision=$(echo "$block_content" | grep -oP '✅ 决策：\K.*' | head -1 || echo "")

                local findings
                findings=$(echo "$block_content" | sed -n '/💡 发现：/,/✅ 决策：/p' | sed '1d;$d' | sed 's/^[[:space:]]*- //' | grep -v '^$' || echo "")
                local findings_formatted=""
                if [ -n "$findings" ]; then
                    while IFS= read -r finding_line; do
                        if [ -n "$finding_line" ]; then
                            findings_formatted="${findings_formatted}> - ${finding_line}"$'\n'
                        fi
                    done <<< "$findings"
                fi

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

    if [ "$block_count" -eq 0 ]; then
        echo '```'
        echo "$reasoning_content"
        echo '```'
    else
        echo "$reasoning_blocks"
    fi
}

generate_timeline() {
    local task_id="$1"
    local log_file="$2"

    echo '```mermaid'
    echo 'timeline'
    local date_only
    date_only=$(date '+%Y-%m-%d')
    local current_time
    current_time=$(date '+%H:%M')

    echo "    $date_only : $current_time 当前更新"

    if [ -f "$log_file" ]; then
        local filter
        filter="[.[] | select(.task == \"${task_id}\" and (.content | type) == \"string\" and (.content | length) > 0)] | .[-5:] | reverse | .[].timestamp_readable"
        jq -s "$filter" "$log_file" 2>/dev/null | while read -r line; do
            if [ -n "$line" ]; then
                local clean_line
                clean_line=$(echo "$line" | tr -d '"')
                local event_date
                event_date=$(echo "$clean_line" | cut -d' ' -f1)
                local event_time
                event_time=$(echo "$clean_line" | cut -d' ' -f2)
                echo "    $event_date : $event_time 任务更新"
            fi
        done
    fi

    echo '```'
}

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
