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

    if [[ "$skill_name" =~ ^u_[a-z_]+$ ]]; then
        echo "user"
    elif [[ "$skill_name" =~ ^k[0-9]+_[a-z_]+$ ]]; then
        echo "task"
    elif [[ "$skill_name" =~ ^p_[a-z_]+$ ]]; then
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
