#!/bin/bash
# SessionStart Hook - 修复损坏的推理文件
# 在会话开始时检测并修复不一致的推理文件

set -e

# 加载共享库
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

# 初始化
init_colors
check_jq || exit 0

# 定义文件路径
REASONING_META="$PROJECT_DIR/.info/.reasoning.meta.json"
REASONING_TASK_LOG="$PROJECT_DIR/.info/.reasoning.log.jsonl"
RESULTS_DIR="$PROJECT_DIR/results"

# 输出函数
log_info() {
    echo -e "${BLUE}[fix-reasoning]${NC} $1" >&2
}

log_success() {
    echo -e "${GREEN}[fix-reasoning]${NC} $1" >&2
}

log_warning() {
    echo -e "${YELLOW}[fix-reasoning]${NC} $1" >&2
}

# 从日志恢复推理内容
recover_reasoning_from_log() {
    local task_id="$1"
    local log_file="$REASONING_TASK_LOG"

    if [ ! -f "$log_file" ]; then
        echo ""
        return
    fi

    # 获取该任务最后一个非空的 reasoning 内容（使用 -r 输出原始字符串）
    jq -s -r \
        "[.[] | select(.task == \"$task_id\" and (.content // \"\" | length) > 0)] | \
         .[-1].content // \"\"" \
        "$log_file" 2>/dev/null
}

# 为指定任务重新生成推理文件
regenerate_reasoning_file() {
    local task_id="$1"
    local reasoning_file="$RESULTS_DIR/$task_id/.reasoning.md"

    # 确保目录存在
    mkdir -p "$(dirname "$reasoning_file")"

    # 从 tasks.json 读取任务信息
    if [ ! -f "$TASKS_FILE" ]; then
        return
    fi

    local task_name=$(json_read "$TASKS_FILE" ".tasks[\"$task_id\"].name // \"$task_id 任务\"")
    local task_status=$(json_read "$TASKS_FILE" ".tasks[\"$task_id\"].status // \"unknown\"")
    local task_type=$(json_read "$TASKS_FILE" ".tasks[\"$task_id\"].type // \"general\"")
    local current_step=$(json_read "$TASKS_FILE" ".tasks[\"$task_id\"].current_step // 0")
    local steps_json=$(json_read "$TASKS_FILE" ".tasks[\"$task_id\"].steps // []")
    local total_steps=$(echo "$steps_json" | jq 'length' 2>/dev/null || echo "0")

    # 从日志恢复推理内容
    local reasoning_content=$(recover_reasoning_from_log "$task_id")

    # 如果推理内容为空且任务已完成，使用默认内容
    if [ -z "$reasoning_content" ] && [ "$task_status" = "completed" ]; then
        reasoning_content="<reasoning>
🎯 目标：任务已完成
🔍 方法：从 tasks.json 和执行日志恢复
💡 发现：
  - 任务 $task_name 已完成
  - 共 $total_steps 个步骤全部执行
  - 推理内容已从日志恢复
✅ 决策：推理文件已自动修复
</reasoning>"
    fi

    # 获取当前时间戳
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')

    # 生成进度条
    local progress_bar=""
    if [ "$total_steps" -gt 0 ]; then
        local percent=$((current_step * 100 / total_steps))
        local filled=$((current_step * 10 / total_steps))
        local empty=$((10 - filled))
        local bar=""
        for ((i=0; i<filled; i++)); do bar+="█"; done
        for ((i=0; i<empty; i++)); do bar+="░"; done
        progress_bar="${bar} ${current_step}/${total_steps} (${percent}%)"
    else
        progress_bar="准备中"
    fi

    # 获取状态 emoji
    local status_emoji=""
    case "$task_status" in
        completed|done) status_emoji="✅" ;;
        active|in_progress) status_emoji="🔄" ;;
        pending) status_emoji="⏳" ;;
        failed|error) status_emoji="❌" ;;
        *) status_emoji="" ;;
    esac

    # 获取当前步骤名称
    local current_step_name="已完成"
    if [ "$current_step" -lt "$total_steps" ] && [ "$total_steps" -gt 0 ]; then
        local step_name=$(echo "$steps_json" | jq -r ".[$current_step]" 2>/dev/null)
        current_step_name=$(echo "$step_name" | sed "s/^${task_id}_//" | sed 's/_/ /g' | sed 's/\b\(.\)/\u\1/g')
    fi

    # 生成简化的 Mermaid 流程图
    local mermaid_chart='```mermaid
flowchart LR
'

    # 使用数组存储步骤，避免管道子进程问题
    local step_list=()
    local step_num=0
    while IFS= read -r step; do
        [ -z "$step" ] && continue
        step_list+=("$step")
        step_num=$((step_num + 1))
    done < <(echo "$steps_json" | jq -r '.[]' 2>/dev/null)

    # 生成节点
    for i in "${!step_list[@]}"; do
        local step="${step_list[$i]}"
        local step_num=$((i + 1))
        local display_name=$(echo "$step" | sed "s/^${task_id}_//" | sed 's/_/ /g' | sed 's/\b\(.\)/\u\1/g')
        local node_color="fill:#f0f0f0,stroke:#999,stroke-width:1px"

        if [ "$step_num" -le "$current_step" ]; then
            node_color="fill:#90EE90,stroke:#333,stroke-width:2px"
        elif [ "$step_num" -eq "$((current_step + 1))" ]; then
            node_color="fill:#FFD700,stroke:#333,stroke-width:3px"
        fi

        mermaid_chart+="    S${step_num}[\"步骤 ${step_num}: ${display_name}\"]
    style S${step_num} ${node_color}
"
    done

    # 添加节点连接
    for i in $(seq 0 $((${#step_list[@]} - 2))); do
        local from=$((i + 1))
        local to=$((i + 2))
        mermaid_chart+="    S${from} --> S${to}
"
    done

    mermaid_chart+='```'

    # 生成步骤详情表
    local step_table="| 步骤 | 技能名称 | 状态 |
|:----:|---------|:----:|
"
    for i in "${!step_list[@]}"; do
        local step="${step_list[$i]}"
        local step_num=$((i + 1))
        local status=""
        if [ "$step_num" -le "$current_step" ]; then
            status="✅ 完成"
        elif [ "$step_num" -eq "$((current_step + 1))" ]; then
            status="🔄 进行中"
        else
            status="⏳ 待执行"
        fi
        step_table+="| ${step_num} | \`${step}\` | ${status} |
"
    done

    # 格式化推理详情（改进版 - 保留结构并添加分隔）
    local reasoning_details=""

    if [ -n "$reasoning_content" ]; then
        # 移除 <reasoning> 标签
        local clean_content="${reasoning_content#<reasoning>}"
        clean_content="${clean_content%</reasoning>}"

        # 只删除开头的空行（保留列表缩进）
        clean_content=$(echo "$clean_content" | sed -e '/./,$!d' -e :a -e '/^\n*$/{$d;N;ba' -e '}')

        # 将每一行转换为引用块格式
        while IFS= read -r line || [ -n "$line" ]; do
            if [ -z "$line" ]; then
                # 空行转换为空引用行（用于分隔段落）
                reasoning_details+=">
"
            else
                reasoning_details+="> ${line}
"
            fi
        done <<< "$clean_content"

        # 移除结尾可能的空引用行
        reasoning_details=$(echo "$reasoning_details" | sed -e ':a' -e '/^> $/ {$d;N;ba' -e '}')
    fi

    # 如果没有推理内容，显示提示
    if [ -z "$reasoning_details" ]; then
        reasoning_details="> 📋 **推理详情暂无**
>
> 该任务的推理内容尚未记录，或已在执行过程中被清空。
"
    fi

    # 生成时间线
    local timeline='```mermaid
timeline
'
    timeline+="
    $(date '+%Y-%m-%d') : 当前修复
"

    # 从日志读取最近的事件
    if [ -f "$REASONING_TASK_LOG" ]; then
        jq -s "[.[] | select(.task == \"$task_id\" and (.content // \"\" | length) > 0)] | .[-5:] | reverse | .[].timestamp_readable" \
            "$REASONING_TASK_LOG" 2>/dev/null | while read -r ts; do
            if [ -n "$ts" ]; then
                local clean_ts=$(echo "$ts" | tr -d '"')
                local event_date=$(echo "$clean_ts" | cut -d' ' -f1)
                local event_time=$(echo "$clean_ts" | cut -d' ' -f2)
                timeline+="    ${event_date} : ${event_time} 任务更新
"
            fi
        done
    fi

    timeline+='```'

    # 生成完整的任务级日志内容
    local task_content="# ${task_name}

**任务 ID**: \`${task_id}\` · **状态**: ${status_emoji} ${task_status^} · **更新**: ${timestamp}

---

## 1. 当前进度

**进度**: \`${progress_bar}\`

**当前步骤**: ${current_step_name}

## 2. 执行流程图

${mermaid_chart}

**步骤详情与方法论**：

${step_table}

---

## 3. 推理详情

${reasoning_details}

---

## 4. 执行时间线

${timeline}
"

    # 写入文件
    echo "$task_content" > "$reasoning_file"

    log_success "已修复: ${task_id} (${task_name})"
}

# 主函数：扫描并修复所有任务
main() {
    log_info "开始检查推理文件..."

    local fixed_count=0
    local checked_count=0

    # 遍历 results 目录下的所有任务（k_, u_, p_ 技能）
    for task_dir in "$RESULTS_DIR"/*/; do
        # 跳过非技能目录（如 .git 等）
        local dirname=$(basename "$task_dir")
        if [[ ! "$dirname" =~ ^[a-z]+[0-9]*$ ]]; then
            continue
        fi
        if [ -d "$task_dir" ]; then
            local task_id=$(basename "$task_dir")
            local reasoning_file="$task_dir/.reasoning.md"

            checked_count=$((checked_count + 1))

            # 检查 reasoning 文件是否存在以及是否需要修复
            local needs_fix=false

            if [ ! -f "$reasoning_file" ]; then
                # 文件不存在，需要创建
                needs_fix=true
            else
                # 文件存在，检查是否需要修复

                # 1. 检查标题是否包含"未知任务"
                if grep -q "未知任务" "$reasoning_file" 2>/dev/null; then
                    needs_fix=true
                fi

                # 2. 检查状态是否为 "Unknown"
                if grep -q "状态.*Unknown" "$reasoning_file" 2>/dev/null; then
                    needs_fix=true
                fi

                # 3. 检查流程图是否为空
                if grep -q 'flowchart LR$' "$reasoning_file" 2>/dev/null; then
                    if ! grep -A 10 'flowchart LR' "$reasoning_file" | grep -q 'S1\['; then
                        needs_fix=true
                    fi
                fi

                # 4. 检查推理详情是否为空
                if grep -q '## 3. 推理详情' "$reasoning_file" 2>/dev/null; then
                    local details_section=$(sed -n '/## 3. 推理详情/,/## 4. 执行时间线/p' "$reasoning_file")
                    if [ -z "$details_section" ] || echo "$details_section" | grep -q "推理详情暂无"; then
                        # 只有当任务已完成时才认为需要修复
                        local task_status=$(json_read "$TASKS_FILE" ".tasks[\"$task_id\"].status // \"unknown\"")
                        if [ "$task_status" = "completed" ]; then
                            needs_fix=true
                        fi
                    fi
                fi
            fi

            # 如果需要修复，重新生成文件
            if [ "$needs_fix" = true ]; then
                log_info "检测到问题: ${task_id}，正在修复..."
                regenerate_reasoning_file "$task_id"
                fixed_count=$((fixed_count + 1))
            fi
        fi
    done

    # 更新元数据文件
    if [ -f "$TASKS_FILE" ]; then
        local meta_updated=false
        local temp_meta=$(mktemp)

        # 重建元数据
        jq -n \
            --arg time "$(date '+%Y-%m-%d %H:%M:%S')" \
            '{"updated_at": $time, "tasks": {}}' > "$temp_meta"

        # 遍历所有任务
        jq -r '.tasks | keys[]' "$TASKS_FILE" 2>/dev/null | while read -r task_id; do
            if [ -n "$task_id" ]; then
                local task_name=$(json_read "$TASKS_FILE" ".tasks[\"$task_id\"].name")
                local task_status=$(json_read "$TASKS_FILE" ".tasks[\"$task_id\"].status")
                local task_type=$(json_read "$TASKS_FILE" ".tasks[\"$task_id\"].type")
                local current_step=$(json_read "$TASKS_FILE" ".tasks[\"$task_id\"].current_step")
                local steps_json=$(json_read "$TASKS_FILE" ".tasks[\"$task_id\"].steps")
                local total_steps=$(echo "$steps_json" | jq 'length' 2>/dev/null || echo "0")
                local reasoning_file="$RESULTS_DIR/$task_id/.reasoning.md"

                # 更新元数据
                temp_meta=$(jq -n \
                    --arg id "$task_id" \
                    --arg name "$task_name" \
                    --arg status "$task_status" \
                    --arg type "$task_type" \
                    --argjson step "$current_step" \
                    --argjson total "$total_steps" \
                    --arg time "$(date '+%Y-%m-%d %H:%M:%S')" \
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
                    }' < "$temp_meta")
            fi
        done

        mv "$temp_meta" "$REASONING_META"
        meta_updated=true
    fi

    # 生成全局索引
    local global_index="# 推理日志索引

> 最后更新: **$(date '+%Y-%m-%d %H:%M:%S')**

---

## 活跃任务

"

    # 添加活跃任务列表
    if [ -f "$REASONING_META" ]; then
        local active_tasks=$(jq -r '.tasks | to_entries[] | select(.value.status != "completed" and .value.status != "archived") | .key' "$REASONING_META" 2>/dev/null)

        if [ -n "$active_tasks" ]; then
            while read -r task_id; do
                if [ -n "$task_id" ]; then
                    local task_name=$(jq -r ".tasks[\"$task_id\"].name" "$REASONING_META")
                    local task_status=$(jq -r ".tasks[\"$task_id\"].status" "$REASONING_META")
                    local task_step=$(jq -r ".tasks[\"$task_id\"].current_step" "$REASONING_META")
                    local task_total=$(jq -r ".tasks[\"$task_id\"].total_steps" "$REASONING_META")
                    local task_file=$(jq -r ".tasks[\"$task_id\"].reasoning_file" "$REASONING_META")

                    # 生成进度条
                    if [ "$task_total" -gt 0 ]; then
                        local percent=$((task_step * 100 / task_total))
                        local filled=$((task_step * 10 / task_total))
                        local empty=$((10 - filled))
                        local bar=""
                        for ((i=0; i<filled; i++)); do bar+="█"; done
                        for ((i=0; i<empty; i++)); do bar+="░"; done
                        local progress="${bar} ${task_step}/${task_total} (${percent}%)"
                    else
                        local progress="准备中"
                    fi

                    global_index+="
### [${task_id}] ${task_name}

**状态**: \`${task_status^}\` | **进度**: \`${progress}\`

📄 **详细推理**: [\`${task_file}\`](${task_file})

"
                fi
            done <<< "$active_tasks"
        else
            global_index+="
*当前没有活跃任务*
"
        fi
    fi

    global_index+="
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

    echo "$global_index" > "$PROJECT_DIR/.info/.reasoning.md"

    # 输出结果
    if [ "$fixed_count" -gt 0 ]; then
        log_success "修复完成: 已修复 ${fixed_count}/${checked_count} 个任务的推理文件"
    else
        log_info "检查完成: 所有 ${checked_count} 个任务的推理文件正常"
    fi
}

# 执行主函数
main "$@"

exit 0
