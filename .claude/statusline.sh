#!/bin/bash
# Statusline: 显示 Claude Code 会话状态（增强版）
# 包含 GLM 配额、任务进度、用户画像、技能统计等

set -e

# 从 stdin 读取 Claude Code 提供的 JSON
input=$(cat)

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
STATUS_FILE="$PROJECT_DIR/.info/.status.json"
QUOTA_CACHE="$HOME/.claude/glm_quota_cache.txt"

# ====== 颜色定义 ======
C_GREEN=$'\033[0;32m'
C_RED=$'\033[0;31m'
C_YELLOW=$'\033[1;33m'
C_BLUE=$'\033[0;34m'
C_CYAN=$'\033[0;36m'
C_MAGENTA=$'\033[0;35m'
C_WHITE=$'\033[0;37m'
C_RESET=$'\033[0m'

# ====== 工具函数 ======

# 格式化 token 数量
format_tokens() {
    local tokens=$1
    if [ "$tokens" -ge 1000000000 ]; then
        echo "$(echo "scale=1; $tokens / 1000000000" | bc 2>/dev/null)B"
    elif [ "$tokens" -ge 1000000 ]; then
        echo "$(echo "scale=1; $tokens / 1000000" | bc 2>/dev/null)M"
    elif [ "$tokens" -ge 1000 ]; then
        echo "$(echo "scale=0; $tokens / 1000" | bc 2>/dev/null)K"
    else
        echo "${tokens}"
    fi
}

# 获取 GLM 配额使用情况（带 5 分钟缓存）
get_glm_quota() {
    local cache_ttl=300  # 5 分钟
    local current_time=$(date +%s)

    # 检查缓存
    if [ -f "$QUOTA_CACHE" ]; then
        local cache_time=$(awk -F'|' '{print $1}' "$QUOTA_CACHE" 2>/dev/null)
        if [ -n "$cache_time" ] && [ $((current_time - cache_time)) -lt $cache_ttl ]; then
            awk -F'|' '{print $2}' "$QUOTA_CACHE" 2>/dev/null
            return 0
        fi
    fi

    # 从环境变量获取认证信息
    local base_url="${ANTHROPIC_BASE_URL:-}"
    local auth_token="${ANTHROPIC_AUTH_TOKEN:-}"

    if [ -z "$auth_token" ] || [ -z "$base_url" ]; then
        return 1
    fi

    # 提取基础域名
    local base_domain=$(echo "$base_url" | sed -E 's|^(https?://[^/]*).*$|\1|')

    # 获取配额信息
    local quota_response=$(curl -s -H "Authorization: ${auth_token}" \
        -H "Content-Type: application/json" \
        "${base_domain}/api/monitor/usage/quota/limit" 2>/dev/null)

    if [ -z "$quota_response" ]; then
        return 1
    fi

    # 解析 TOKENS_LIMIT 数据
    local percentage=$(echo "$quota_response" | jq -r '.data.limits[]? | select(.type=="TOKENS_LIMIT") | .percentage // empty' 2>/dev/null)
    local remaining=$(echo "$quota_response" | jq -r '.data.limits[]? | select(.type=="TOKENS_LIMIT") | .remaining // 0' 2>/dev/null)

    if [ -z "$percentage" ]; then
        return 1
    fi

    # 格式化剩余 token
    local remaining_str
    if [ "$remaining" -ge 1000000000 ]; then
        remaining_str="$(echo "scale=1; $remaining / 1000000000" | bc)B"
    elif [ "$remaining" -ge 1000000 ]; then
        remaining_str="$(echo "scale=1; $remaining / 1000000" | bc)M"
    elif [ "$remaining" -ge 1000 ]; then
        remaining_str="$(echo "scale=0; $remaining / 1000" | bc)K"
    else
        remaining_str="${remaining}"
    fi

    # 根据百分比设置颜色
    local color
    if [ "$percentage" -gt 80 ]; then
        color="${C_RED}"
    elif [ "$percentage" -gt 50 ]; then
        color="${C_YELLOW}"
    else
        color="${C_GREEN}"
    fi

    local result="${color}💎 ${percentage}% (${remaining_str})${C_RESET}"

    # 保存到缓存
    echo "${current_time}|${result}" > "$QUOTA_CACHE"

    echo "$result"
}

# 获取上下文使用率
get_context_usage() {
    local context_size=$(echo "$input" | jq -r '.context_window.context_window_size // 0')
    local input_tokens=$(echo "$input" | jq -r '.context_window.total_input_tokens // 0')
    local output_tokens=$(echo "$input" | jq -r '.context_window.total_output_tokens // 0')

    if [ "$context_size" -le 0 ]; then
        return 1
    fi

    local total=$((input_tokens + output_tokens))
    local pct=$((total * 100 / context_size))

    local color
    if [ "$pct" -gt 80 ]; then
        color="${C_RED}"
    elif [ "$pct" -gt 50 ]; then
        color="${C_YELLOW}"
    else
        color="${C_GREEN}"
    fi

    echo "${color}📊 ${pct}%${C_RESET}"
}

# 获取会话持续时间
get_session_duration() {
    local duration_ms=$(echo "$input" | jq -r '.cost.total_duration_ms // 0')

    if [ -z "$duration_ms" ] || [ "$duration_ms" = "null" ] || [ "$duration_ms" = "0" ]; then
        return 1
    fi

    local duration_sec=$((duration_ms / 1000))
    local minutes=$((duration_sec / 60))
    local seconds=$((duration_sec % 60))

    if [ "$minutes" -gt 0 ]; then
        echo "${C_YELLOW}⏳ ${minutes}m${seconds}s${C_RESET}"
    else
        echo "${C_YELLOW}⏳ ${seconds}s${C_RESET}"
    fi
}

# 获取 Token 使用统计
get_token_stats() {
    local input_tokens=$(echo "$input" | jq -r '.context_window.total_input_tokens // 0')
    local output_tokens=$(echo "$input" | jq -r '.context_window.total_output_tokens // 0')

    if [ "$input_tokens" -le 0 ] && [ "$output_tokens" -le 0 ]; then
        return 1
    fi

    local input_str=$(format_tokens "$input_tokens")
    local output_str=$(format_tokens "$output_tokens")

    echo "${C_CYAN}↑${input_str}${C_RESET} ${C_CYAN}↓${output_str}${C_RESET}"
}

# 获取用户系统状态
get_system_status() {
    if [ ! -f "$STATUS_FILE" ]; then
        return 1
    fi

    local active_task=$(jq -r '.active_task // ""' "$STATUS_FILE" 2>/dev/null)
    local task_name=$(jq -r '.task_name // ""' "$STATUS_FILE" 2>/dev/null)
    local total=$(jq -r '.total_steps // 0' "$STATUS_FILE" 2>/dev/null)
    local completed=$(jq -r '.completed_steps // 0' "$STATUS_FILE" 2>/dev/null)
    local user_name=$(jq -r '.user_name // ""' "$STATUS_FILE" 2>/dev/null)
    local profile_fresh=$(jq -r '.profile_fresh // true' "$STATUS_FILE" 2>/dev/null)
    local skills_count=$(jq -r '.skills_count // 0' "$STATUS_FILE" 2>/dev/null)

    local result=""
    local has_content=false

    # 任务进度
    if [ -n "$active_task" ]; then
        if [ "$total" -gt 0 ]; then
            FILLED=$((completed * 8 / total))
            EMPTY=$((8 - FILLED))
            PROGRESS="["
            for i in $(seq 1 $FILLED); do PROGRESS="${PROGRESS}█"; done
            for i in $(seq 1 $EMPTY); do PROGRESS="${PROGRESS}░"; done
            PROGRESS="${PROGRESS}]"
        else
            PROGRESS="[.........]"
        fi

        SHORT_NAME=$(echo "$task_name" | cut -c1-12)
        if [ ${#task_name} -gt 12 ]; then
            SHORT_NAME="${SHORT_NAME}..."
        fi

        result="${C_BLUE}📋${C_RESET} ${active_task} ${SHORT_NAME} ${PROGRESS} ${completed}/${total}"
        has_content=true
    fi

    # 用户画像
    if [ -n "$user_name" ]; then
        FRESH_ICON=""
        if [ "$profile_fresh" = "false" ]; then
            FRESH_ICON="${C_YELLOW}⚠️${C_RESET}"
        fi
        if [ "$has_content" = true ]; then
            result="${result} | ${C_MAGENTA}👤${C_RESET} ${user_name}${FRESH_ICON}"
        else
            result="${C_MAGENTA}👤${C_RESET} ${user_name}${FRESH_ICON}"
            has_content=true
        fi
    fi

    # 技能统计
    if [ "$has_content" = true ]; then
        result="${result} | ${C_CYAN}🔧${C_RESET} ${skills_count}技能"
    else
        result="${C_CYAN}🔧${C_RESET} ${skills_count}技能"
    fi

    echo "$result"
}

# ====== 主显示逻辑 ======

# 提取基础信息
MODEL=$(echo "$input" | jq -r '.model.display_name // "Claude"')

# 获取各模块数据
QUOTA_INFO=$(get_glm_quota)
CONTEXT_PCT=$(get_context_usage)
SESSION_TIME=$(get_session_duration)
TOKEN_STATS=$(get_token_stats)
SYSTEM_STATUS=$(get_system_status)

# 构建输出
OUTPUT="[${MODEL}]"
OUTPUT="$OUTPUT $QUOTA_INFO $CONTEXT_PCT"

# 会话时间
if [ -n "$SESSION_TIME" ]; then
    OUTPUT="$OUTPUT $SESSION_TIME"
fi

# 系统状态（任务、用户、技能）
if [ -n "$SYSTEM_STATUS" ]; then
    OUTPUT="$OUTPUT | $SYSTEM_STATUS"
fi

printf '%b\n' "$OUTPUT"
