#!/bin/bash
# Claude Code 状态行脚本 - Skills Demo 版本
# 参考 cc_plugins 优化，保留项目特有功能

# 从 stdin 读取 Claude Code 提供的 JSON
input=$(cat || true)

# 如果 input 为空，尝试从参数读取
if [ -z "$input" ]; then
    input="$1"
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
PROJECT_DIR="$(cd "$PROJECT_DIR" && pwd)"
STATUS_FILE="$PROJECT_DIR/.info/.status.json"
QUOTA_CACHE="$HOME/.claude/glm_quota_cache.txt"

# ====== 统一提取常用 JSON 字段（jq 性能优化） ======
# 一次性提取所有常用字段，避免重复调用 jq

# 1. context_window 相关（合并多个 jq 为 1 次）
context_data=$(echo "$input" | jq -r '
    .context_window.context_window_size // "0",
    .context_window.current_usage.input_tokens // "0",
    .context_window.current_usage.output_tokens // "0",
    .context_window.current_usage.cache_read_input_tokens // "0",
    .context_window.current_usage.cache_creation_input_tokens // "0",
    .context_window.total_input_tokens // "0",
    .context_window.total_output_tokens // "0"
' 2>/dev/null)

context_window_size=$(echo "$context_data" | sed -n '1p')
context_input=$(echo "$context_data" | sed -n '2p')
context_output=$(echo "$context_data" | sed -n '3p')
context_cache_read=$(echo "$context_data" | sed -n '4p')
context_cache_creation=$(echo "$context_data" | sed -n '5p')
total_input_tokens=$(echo "$context_data" | sed -n '6p')
total_output_tokens=$(echo "$context_data" | sed -n '7p')

# 如果 context_window 存在，则保留 context_usage 用于验证
context_usage=$(echo "$input" | jq -r '.context_window.current_usage // empty')

# 2. cost 相关（合并 3 个 jq 为 1 次）
cost_data=$(echo "$input" | jq -r '
    .cost.total_duration_ms // "0",
    .cost.total_lines_added // "0",
    .cost.total_lines_removed // "0"
' 2>/dev/null)

cost_total_duration_ms=$(echo "$cost_data" | sed -n '1p')
cost_lines_added=$(echo "$cost_data" | sed -n '2p')
cost_lines_removed=$(echo "$cost_data" | sed -n '3p')

# 3. model 信息
MODEL=$(echo "$input" | jq -r '.model.display_name // "Claude"')

# ====== JSON 字段提取完成 ======

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

# 格式化 token 数量为 K/M/B
format_tokens() {
    local tokens=$1

    if [ -z "$tokens" ] || [ "$tokens" = "null" ] || [ "$tokens" -le 0 ] 2>/dev/null; then
        echo "0"
        return
    fi

    if [ "$tokens" -ge 1000000000 ] 2>/dev/null; then
        local billions=$((tokens / 1000000000))
        local remainder=$((tokens % 1000000000))
        if [ $remainder -ge 100000000 ]; then
            echo "${billions}.$((remainder / 100000000))B"
        else
            echo "${billions}B"
        fi
    elif [ "$tokens" -ge 1000000 ] 2>/dev/null; then
        local millions=$((tokens / 1000000))
        local remainder=$((tokens % 1000000))
        if [ $remainder -ge 100000 ]; then
            echo "${millions}.$((remainder / 100000))M"
        else
            echo "${millions}M"
        fi
    elif [ "$tokens" -ge 1000 ] 2>/dev/null; then
        echo "$((tokens / 1000))K"
    else
        echo "${tokens}"
    fi
}

# 获取上下文窗口使用百分比（参考 cc_plugins）
get_context_usage() {
    # 使用全局变量（已在脚本开头提取）
    if [ -z "$context_usage" ] || [ "$context_usage" = "null" ]; then
        return 0
    fi

    # 当前上下文总量 = 输入 + 缓存创建 + 缓存读取
    local current=$((context_input + context_cache_creation + context_cache_read))

    if [ "$context_window_size" -gt 0 ] 2>/dev/null; then
        local pct=$((current * 100 / context_window_size))
        if [ "$pct" -gt 80 ]; then
            echo "${C_RED}📊 ${pct}%${C_RESET}"
        elif [ "$pct" -gt 50 ]; then
            echo "${C_YELLOW}📊 ${pct}%${C_RESET}"
        else
            echo "${C_GREEN}📊 ${pct}%${C_RESET}"
        fi
    fi
}

# 获取上下文详细统计 (输入/输出)
get_context_io() {
    # 使用全局变量（已在脚本开头提取）
    if [ -z "$context_usage" ] || [ "$context_usage" = "null" ]; then
        return 0
    fi

    # 使用公共函数格式化
    local input_str=$(format_tokens "$context_input")
    local output_str=$(format_tokens "$context_output")

    echo "${C_CYAN}↑${input_str}${C_RESET} ${C_CYAN}↓${output_str}${C_RESET}"
}

# 获取缓存命中率
get_cache_hit_rate() {
    # 使用全局变量（已在脚本开头提取）
    if [ -z "$context_usage" ] || [ "$context_usage" = "null" ]; then
        return 0
    fi

    # 缓存命中率计算公式
    # total_tokens = input_tokens + cache_read_input_tokens
    # 缓存命中率 = cache_read / (input + cache_read)
    local total_tokens=$((context_input + context_cache_read))

    if [ "$total_tokens" -le 0 ] 2>/dev/null; then
        return 0
    fi

    local cache_pct=$((context_cache_read * 100 / total_tokens))

    # 根据命中率设置颜色
    local color
    if [ "$cache_pct" -gt 50 ]; then
        color="${C_GREEN}"
    elif [ "$cache_pct" -gt 20 ]; then
        color="${C_CYAN}"
    else
        color="${C_YELLOW}"
    fi

    echo "${color}💾 ${cache_pct}%${C_RESET}"
}

# 获取会话持续时间
get_session_duration() {
    # 使用全局变量（已在脚本开头提取）
    local duration_ms="$cost_total_duration_ms"

    if [ -z "$duration_ms" ] || [ "$duration_ms" = "null" ] || [ "$duration_ms" = "0" ]; then
        return 0
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

# 获取代码变更统计
get_code_changes() {
    # 使用全局变量（已在脚本开头提取）
    local lines_added="$cost_lines_added"
    local lines_removed="$cost_lines_removed"

    if [ "$lines_added" -gt 0 ] 2>/dev/null || [ "$lines_removed" -gt 0 ] 2>/dev/null; then
        echo "${C_GREEN}+${lines_added}${C_RESET} ${C_RED}-${lines_removed}${C_RESET}"
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
            local cached_result=$(awk -F'|' '{print $2}' "$QUOTA_CACHE" 2>/dev/null)
            local cached_countdown=$(awk -F'|' '{print $3}' "$QUOTA_CACHE" 2>/dev/null)
            if [ -n "$cached_countdown" ] && [ "$cached_countdown" != "" ]; then
                echo "${cached_result} ${cached_countdown}"
            else
                echo "$cached_result"
            fi
            return 0
        fi
    fi

    # 从环境变量获取认证信息
    local base_url="${ANTHROPIC_BASE_URL:-}"
    local auth_token="${ANTHROPIC_AUTH_TOKEN:-}"

    if [ -z "$auth_token" ] || [ -z "$base_url" ]; then
        return 0
    fi

    # 提取基础域名
    local base_domain=$(echo "$base_url" | sed -E 's|^(https?://[^/]*).*$|\1|')

    # 获取配额信息
    local quota_response=$(curl -s -H "Authorization: ${auth_token}" \
        -H "Content-Type: application/json" \
        "${base_domain}/api/monitor/usage/quota/limit" 2>/dev/null)

    if [ -z "$quota_response" ]; then
        return 0
    fi

    # 解析 TOKENS_LIMIT 数据（使用 | 分隔）
    local quota_data=$(echo "$quota_response" | jq -r '.data.limits[]? | select(.type=="TOKENS_LIMIT") | "\(.percentage)|\(.currentValue)|\(.remaining)|\(.nextResetTime)" // empty' 2>/dev/null)
    local percentage=$(echo "$quota_data" | cut -d'|' -f1)
    local used=$(echo "$quota_data" | cut -d'|' -f2)
    local remaining=$(echo "$quota_data" | cut -d'|' -f3)
    local reset_time_ms=$(echo "$quota_data" | cut -d'|' -f4)

    if [ -z "$percentage" ]; then
        return 0
    fi

    # 格式化使用量 token
    local used_str
    if [ "$used" -ge 1000000000 ] 2>/dev/null; then
        local billions=$((used / 1000000000))
        local remainder=$((used % 1000000000))
        if [ $remainder -ge 100000000 ]; then
            used_str="${billions}.$((remainder / 100000000))B"
        else
            used_str="${billions}B"
        fi
    elif [ "$used" -ge 1000000 ] 2>/dev/null; then
        local millions=$((used / 1000000))
        local remainder=$((used % 1000000))
        if [ $remainder -ge 100000 ]; then
            used_str="${millions}.$((remainder / 100000))M"
        else
            used_str="${millions}M"
        fi
    elif [ "$used" -ge 1000 ] 2>/dev/null; then
        used_str="$((used / 1000))K"
    else
        used_str="${used}"
    fi

    # 计算重置时间倒计时
    local countdown_str=""
    if [ -n "$reset_time_ms" ] && [ "$reset_time_ms" != "null" ]; then
        local reset_time_sec=$((reset_time_ms / 1000))
        local time_left=$((reset_time_sec - current_time))

        if [ "$time_left" -gt 0 ]; then
            if [ "$time_left" -ge 3600 ]; then
                local hours=$((time_left / 3600))
                local minutes=$(((time_left % 3600) / 60))
                countdown_str="🕐 ${hours}h${minutes}m"
            elif [ "$time_left" -ge 60 ]; then
                local minutes=$((time_left / 60))
                countdown_str="🕐 ${minutes}m"
            else
                countdown_str="🕐 ${time_left}s"
            fi
        fi
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

    local result="${color}💎 ${percentage}% (${used_str})${C_RESET}"

    # 保存到缓存（包含倒计时）
    echo "${current_time}|${result}|${countdown_str}" > "$QUOTA_CACHE"

    # 输出结果（带倒计时）
    if [ -n "$countdown_str" ]; then
        echo "${result} ${C_WHITE}${countdown_str}${C_RESET}"
    else
        echo "$result"
    fi
}

# 获取用户系统状态
get_system_status() {
    if [ ! -f "$STATUS_FILE" ]; then
        return 0
    fi

    local active_task=$(jq -r '.active_task // ""' "$STATUS_FILE" 2>/dev/null)
    local task_name=$(jq -r '.task_name // ""' "$STATUS_FILE" 2>/dev/null)
    local total=$(jq -r '.total_steps // 0' "$STATUS_FILE" 2>/dev/null)
    local completed=$(jq -r '.completed_steps // 0' "$STATUS_FILE" 2>/dev/null)
    local user_name=$(jq -r '.user_name // ""' "$STATUS_FILE" 2>/dev/null)
    local profile_fresh=$(jq -r '.profile_fresh // true' "$STATUS_FILE" 2>/dev/null)
    local skills_count=$(jq -r '.skills_count // 0' "$STATUS_FILE" 2>/dev/null)

    # 获取技能使用次数（通过解析会话文件）
    local skills_usage=0
    local usage_script="$PROJECT_DIR/.claude/hooks/count-skills-usage.sh"
    if [ -f "$usage_script" ]; then
        skills_usage=$("$usage_script" 2>/dev/null) || skills_usage=0
    fi

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

    # 技能统计（显示数量和使用次数）
    if [ "$has_content" = true ]; then
        if [ "$skills_usage" -gt 0 ]; then
            result="${result} | ${C_CYAN}🔧${C_RESET} ${skills_count}技能(${skills_usage}次)"
        else
            result="${result} | ${C_CYAN}🔧${C_RESET} ${skills_count}技能"
        fi
    else
        if [ "$skills_usage" -gt 0 ]; then
            result="${C_CYAN}🔧${C_RESET} ${skills_count}技能(${skills_usage}次)"
        else
            result="${C_CYAN}🔧${C_RESET} ${skills_count}技能"
        fi
    fi

    echo "$result"
}

# ====== 主显示逻辑 ======

# 获取各模块数据（使用已提取的全局变量）
QUOTA_INFO=$(get_glm_quota)
CONTEXT_PCT=$(get_context_usage)
CONTEXT_IO=$(get_context_io)
CACHE_RATE=$(get_cache_hit_rate)
SESSION_TIME=$(get_session_duration)
CODE_CHANGES=$(get_code_changes)
SYSTEM_STATUS=$(get_system_status)

# 构建输出
OUTPUT="[${MODEL}]"

# 第一行：核心信息
OUTPUT="$OUTPUT $QUOTA_INFO $CONTEXT_PCT"

# 会话时间
if [ -n "$SESSION_TIME" ]; then
    OUTPUT="$OUTPUT $SESSION_TIME"
fi

# Token 统计和缓存命中率
if [ -n "$CONTEXT_IO" ] && [ -n "$CACHE_RATE" ]; then
    OUTPUT="$OUTPUT $CONTEXT_IO $CACHE_RATE"
fi

# 代码变更
if [ -n "$CODE_CHANGES" ]; then
    OUTPUT="$OUTPUT $CODE_CHANGES"
fi

# 系统状态（任务、用户、技能）
if [ -n "$SYSTEM_STATUS" ]; then
    OUTPUT="$OUTPUT | $SYSTEM_STATUS"
fi

printf '%b\n' "$OUTPUT"
