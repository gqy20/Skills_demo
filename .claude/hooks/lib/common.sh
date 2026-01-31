#!/bin/bash
# Common Library for Skills Hooks
# 共享函数库，提供项目初始化、颜色输出、JSON 操作等功能

# =============================================================================
# 项目路径初始化
# =============================================================================

# 初始化项目路径变量
# 使用方法: project_dir_init && echo "$PROJECT_DIR"
project_dir_init() {
    PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
    TASKS_FILE="$PROJECT_DIR/.info/tasks.json"
    SKILLS_DIR="$PROJECT_DIR/.claude/skills"
    INFO_DIR="$PROJECT_DIR/info"
    STATUS_FILE="$PROJECT_DIR/.info/.status.json"
    PROFILE_FILE="$PROJECT_DIR/.info/usr.json"
    CHANGELOG="$PROJECT_DIR/.info/skills_changelog.jsonl"
    ARCHIVE_DIR="$PROJECT_DIR/.claude/skills/.archived"

    export PROJECT_DIR TASKS_FILE SKILLS_DIR INFO_DIR STATUS_FILE
    export PROFILE_FILE CHANGELOG ARCHIVE_DIR
}

# =============================================================================
# 颜色输出
# =============================================================================

# 初始化颜色变量
init_colors() {
    GREEN='\033[0;32m'
    BLUE='\033[0;34m'
    YELLOW='\033[1;33m'
    RED='\033[0;31m'
    NC='\033[0m'

    export GREEN BLUE YELLOW RED NC
}

# =============================================================================
# 依赖检查
# =============================================================================

# 检查 jq 是否安装
check_jq() {
    if ! command -v jq >/dev/null 2>&1; then
        echo -e "${YELLOW}⚠️  需要安装 jq: brew install jq 或 apt install jq${NC}"
        return 1
    fi
    return 0
}

# =============================================================================
# JSON 操作
# =============================================================================

# 原子性更新 JSON 文件
# 用法: atomic_json_update <file> <jq_expression>
atomic_json_update() {
    local file="$1"
    local jq_expr="$2"

    if [ ! -f "$file" ]; then
        echo "错误: 文件不存在: $file" >&2
        return 1
    fi

    local temp_file=$(mktemp)
    if jq "$jq_expr" "$file" > "$temp_file" 2>/dev/null; then
        mv "$temp_file" "$file"
        return 0
    else
        rm -f "$temp_file"
        echo "错误: JSON 更新失败" >&2
        return 1
    fi
}

# 安全读取 JSON 值
# 用法: json_read <file> <jq_expression>
json_read() {
    local file="$1"
    local jq_expr="$2"

    if [ ! -f "$file" ]; then
        echo ""
        return 1
    fi

    jq -r "$jq_expr" "$file" 2>/dev/null || echo ""
}

# =============================================================================
# 技能类型判断
# =============================================================================

# 判断技能类型
# 用法: get_skill_type <skill_name>
# 输出: user|task|proven|builtin
get_skill_type() {
    local skill_name="$1"

    if [[ "$skill_name" =~ ^u_[a-z][a-z0-9_]*$ ]]; then
        echo "user"
    elif [[ "$skill_name" =~ ^k[0-9]+(_[a-z][a-z0-9_]*)?$ ]]; then
        echo "task"
    elif [[ "$skill_name" =~ ^p_[a-z][a-z0-9_]*$ ]]; then
        echo "proven"
    else
        echo "builtin"
    fi
}

# =============================================================================
# 技能数量统计
# =============================================================================

# 获取指定类型技能的数量
# 用法: get_skill_count <user|task|proven>
get_skill_count() {
    local skill_type="$1"
    project_dir_init

    case "$skill_type" in
        user)
            json_read "$TASKS_FILE" '.user_skills | length'
            ;;
        proven)
            json_read "$TASKS_FILE" 'if .proven_skills then (.proven_skills | length) else 0 end'
            ;;
        *)
            echo "0"
            ;;
    esac
}

# =============================================================================
# 数量限制检查
# =============================================================================

# 检查技能数量是否超限
# 用法: check_skill_limit <user|proven> [count]
# 返回: 0=未超限, 1=超限
check_skill_limit() {
    local skill_type="$1"
    local current_count="$2"
    local max_count=""

    init_colors

    case "$skill_type" in
        user)
            max_count=5
            ;;
        proven)
            max_count=10
            ;;
        *)
            return 0
            ;;
    esac

    if [ "$current_count" -ge "$max_count" ]; then
        echo -e "${YELLOW}⚠️  ${skill_type}_ 技能已达上限 ($max_count 个)${NC}"
        echo -e "${BLUE}当前 ${skill_type}_ 技能数${NC}: $current_count"
        echo ""
        echo "请先归档低频技能："
        echo "  查看技能: jq '.${skill_type}_skills' $TASKS_FILE"
        echo "  归档技能: 删除 tasks.json 中的对应条目"
        return 1
    fi

    return 0
}

# =============================================================================
# 时间戳
# =============================================================================

# 获取 UTC 时间戳
# 用法: get_timestamp
get_timestamp() {
    date -u +%Y-%m-%dT%H:%M:%SZ
}

# 获取文件修改时间（Unix 时间戳）
# 用法: get_file_mtime <file>
get_file_mtime() {
    local file="$1"

    if [ ! -f "$file" ]; then
        echo ""
        return 1
    fi

    if stat -f %m "$file" >/dev/null 2>&1; then
        stat -f %m "$file"
    else
        stat -c %Y "$file" 2>/dev/null
    fi
}

# =============================================================================
# 日志记录
# =============================================================================

# 记录到 changelog
# 用法: log_changelog <tool> <skill_type> <skill_name> <path>
log_changelog() {
    local tool="$1"
    local skill_type="$2"
    local skill_name="$3"
    local path="$4"
    local timestamp=$(get_timestamp)

    project_dir_init

    cat >> "$CHANGELOG" <<EOF
{"timestamp": "$timestamp", "tool": "$tool", "skill_type": "$skill_type", "skill_name": "$skill_name", "path": "$path"}
EOF
}

# =============================================================================
# 技能使用统计
# =============================================================================

# 增加 p_ 技能的使用次数
# 用法: increment_p_skill_usage <p_skill_name> [related_task]
increment_p_skill_usage() {
    local skill_name="$1"
    local related_task="${2:-}"

    # 只处理 p_ 技能
    if [ "$(get_skill_type "$skill_name")" != "proven" ]; then
        return 0
    fi

    project_dir_init

    # 检查技能是否存在
    if ! json_read "$TASKS_FILE" ".proven_skills[\"$skill_name\"]" >/dev/null 2>&1; then
        return 0
    fi

    # 构建 jq 更新表达式
    local jq_expr=".proven_skills[\"$skill_name\"].usage_count += 1"

    # 如果指定了关联任务，添加到 related_tasks
    if [ -n "$related_task" ]; then
        jq_expr="$jq_expr | .proven_skills[\"$skill_name\"].related_tasks += [\"$related_task\"] | .proven_skills[\"$skill_name\"].related_tasks |= unique"
    fi

    # 更新最后使用时间
    jq_expr="$jq_expr | .proven_skills[\"$skill_name\"].last_used_at = \"$(get_timestamp)\""

    atomic_json_update "$TASKS_FILE" "$jq_expr"
}

# 记录技能被调用（用于统计使用次数）
# 用法: log_skill_usage <skill_name> <context>
log_skill_usage() {
    local skill_name="$1"
    local context="${2:-general}"
    local timestamp=$(get_timestamp)
    local usage_file="$PROJECT_DIR/.info/skills_usage.jsonl"

    project_dir_init

    # 记录使用日志
    echo "{\"timestamp\": \"$timestamp\", \"skill\": \"$skill_name\", \"context\": \"$context\"}" >> "$usage_file"

    # 如果是 p_ 技能，自动增加 usage_count
    increment_p_skill_usage "$skill_name" "$context"
}

# =============================================================================
# 技能事件日志
# =============================================================================

# 记录技能事件（统一的技能事件日志）
# 用法: log_skill_event <event_type> <skill_name> [key1 value1 ...]
# 事件类型: skill_created, skill_promoted, skill_reused, skill_edited, skill_archived
log_skill_event() {
    local event_type="$1"
    local skill_name="$2"
    shift 2
    local timestamp=$(get_timestamp)
    local event_file="$PROJECT_DIR/.info/skills_events.jsonl"

    project_dir_init

    # 构建 JSON 基础结构
    local json="{\"timestamp\": \"$timestamp\", \"event\": \"$event_type\", \"skill\": \"$skill_name\""

    # 添加额外数据
    while [ $# -gt 0 ]; do
        local key="$1"
        local value="$2"
        shift 2
        json="$json, \"$key\": $value"
    done

    json="$json}"

    # 写入事件日志
    echo "$json" >> "$event_file"

    # 特殊事件处理
    case "$event_type" in
        skill_reused)
            # 技能复用时，增加 usage_count
            local related_task=""
            for ((i=1; i<=$#; i++)); do
                if [ "${!i}" == '"task"' ]; then
                    related_task="${!((i+1))}"
                    break
                fi
            done
            increment_p_skill_usage "$skill_name" "$related_task"
            ;;
        skill_edited)
            # 技能编辑时，也增加 usage_count（表示被使用）
            increment_p_skill_usage "$skill_name"
            ;;
    esac
}

# 检查 p_ 技能是否可以被任务复用
# 用法: find_reusable_p_skill <task_description>
# 输出: 匹配的 p_ 技能名称或空
find_reusable_p_skill() {
    local task_desc="$1"

    project_dir_init

    # 获取所有 p_ 技能
    local p_skills=$(jq -r '.proven_skills | keys[]' "$TASKS_FILE" 2>/dev/null || echo "")

    # 简单匹配逻辑（可以扩展为更复杂的相似度计算）
    for p_skill in $p_skills; do
        # 检查技能名称中的关键词
        local skill_keywords=$(echo "$p_skill" | sed 's/p_//' | sed 's/_/ /g')

        # 如果任务描述包含技能关键词，返回该技能
        if echo "$task_desc" | grep -qi "$skill_keywords"; then
            echo "$p_skill"
            return 0
        fi
    done

    echo ""
}

# 获取最热门的 p_ 技能
# 用法: get_top_p_skill [limit]
# 输出: "skill_name:count" 格式
get_top_p_skill() {
    local limit="${1:-1}"

    project_dir_init

    jq -r ".proven_skills | to_entries | sort_by(.value.usage_count // 0) | reverse | .[0:$limit] |
           .[] | \"\(.key): \(.value.usage_count // 0)\"" "$TASKS_FILE" 2>/dev/null || echo ""
}

# 获取技能复用统计
# 用法: get_reuse_stats
# 输出: JSON 格式的复用统计
get_reuse_stats() {
    project_dir_init

    jq '{
        total_reuses: ([.proven_skills[].usage_count // 0] | add),
        top_skill: (.proven_skills | to_entries | max_by(.value.usage_count // 0) | .key),
        top_count: (.proven_skills | to_entries | max_by(.value.usage_count // 0) | .value.usage_count // 0),
        active_skills: ([.proven_skills[] | select(.usage_count // 0 > 0)] | length)
    }' "$TASKS_FILE" 2>/dev/null || echo '{"total_reuses": 0, "top_skill": "", "top_count": 0, "active_skills": 0}'
}

# =============================================================================
# 导出函数
# =============================================================================

# 默认初始化
if [ -z "$PROJECT_DIR" ]; then
    project_dir_init
fi

if [ -z "$GREEN" ]; then
    init_colors
fi

export -f project_dir_init init_colors check_jq
export -f atomic_json_update json_read
export -f get_skill_type get_skill_count check_skill_limit
export -f get_timestamp get_file_mtime log_changelog
export -f increment_p_skill_usage log_skill_usage
export -f log_skill_event find_reusable_p_skill get_top_p_skill get_reuse_stats
