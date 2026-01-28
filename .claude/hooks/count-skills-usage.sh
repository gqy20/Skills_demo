#!/bin/bash
# 统计项目技能使用次数
# 通过解析 ~/.claude/projects/ 中的会话历史文件和全局历史

set -e

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
PROJECT_PATH="$(cd "$PROJECT_DIR" && pwd)"
PROJECT_NAME=$(basename "$PROJECT_PATH")
CACHE_FILE="$PROJECT_DIR/.info/skills_usage_cache.json"
CACHE_TTL=300  # 5分钟缓存

# 颜色
GREEN='\033[0;32m'
NC='\033[0m'

# 获取会话文件目录
SESSIONS_DIR="$HOME/.claude/projects"
GLOBAL_HISTORY="$HOME/.claude/history.jsonl"

if [ ! -d "$SESSIONS_DIR" ] && [ ! -f "$GLOBAL_HISTORY" ]; then
    echo "0"
    exit 0
fi

# 检查缓存
current_time=$(date +%s)
if [ -f "$CACHE_FILE" ]; then
    cache_time=$(stat -c %Y "$CACHE_FILE" 2>/dev/null || stat -f %m "$CACHE_FILE" 2>/dev/null)
    if [ -n "$cache_time" ] && [ $((current_time - cache_time)) -lt $CACHE_TTL ]; then
        # 缓存有效，返回总使用次数
        jq -r '.total_usage // 0' "$CACHE_FILE" 2>/dev/null || echo "0"
        exit 0
    fi
fi

# 统计技能使用次数
total_usage=0
declare -A skill_counts

# 1. 从项目会话文件中统计（如果存在）
if [ -d "$SESSIONS_DIR" ]; then
    # 查找匹配当前项目的会话目录
    SESSION_DIR_NAME=$(echo "$PROJECT_PATH" | sed 's|/|-|g')
    SESSION_DIR="$SESSIONS_DIR/$SESSION_DIR_NAME"

    if [ -d "$SESSION_DIR" ]; then
        for session_file in "$SESSION_DIR"/*.jsonl; do
            [ -f "$session_file" ] || continue

            # 提取技能调用（name 以 / 开头的 tool_use）
            while IFS= read -r skill_name; do
                if [ -n "$skill_name" ]; then
                    ((skill_counts[$skill_name]++)) || true
                    ((total_usage++)) || true
                fi
            done < <(jq -r 'select(.type == "assistant") | .message.content[]? | select(.type == "tool_use" and (.name | startswith("/"))) | .name' "$session_file" 2>/dev/null)
        done
    fi
fi

# 2. 从全局历史文件中统计（如果存在）
if [ -f "$GLOBAL_HISTORY" ]; then
    while IFS= read -r skill_name; do
        # 去除首尾空格
        skill_name=$(echo "$skill_name" | xargs)
        if [ -n "$skill_name" ]; then
            ((skill_counts[$skill_name]++)) || true
            ((total_usage++)) || true
        fi
    done < <(jq -r 'select(.display | startswith("/")) | .display' "$GLOBAL_HISTORY" 2>/dev/null)
fi

# 构建结果 JSON
result="{}"
for skill in "${!skill_counts[@]}"; do
    count=${skill_counts[$skill]}
    result=$(echo "$result" | jq --arg s "$skill" --argjson c "$count" '.[$s] = $c')
done
result=$(echo "$result" | jq --argjson total "$total_usage" '.total_usage = $total')

# 保存到缓存
echo "$result" | jq '.' > "$CACHE_FILE"

# 输出总使用次数
echo "$total_usage"

exit 0
