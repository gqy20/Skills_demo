#!/bin/bash
# SessionStart Hook - 显示用户画像状态（从 .status.json 读取）

set -e

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
STATUS_FILE="$PROJECT_DIR/.info/.status.json"
PROFILE_FILE="$PROJECT_DIR/.info/usr.json"
UPDATE_HOOK="$PROJECT_DIR/.claude/hooks/update-status.sh"

# 颜色输出
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 首先更新状态（调用 update-status.sh 执行检查逻辑）
if [ -f "$UPDATE_HOOK" ]; then
    bash "$UPDATE_HOOK" >/dev/null 2>&1 || true
fi

# 检查画像是否存在
if [ ! -f "$PROFILE_FILE" ]; then
    echo -e "${YELLOW}⚠️  用户画像不存在${NC}"
    echo "建议运行: /user-profile 生成画像"
    exit 0
fi

# 从状态文件读取画像新鲜度信息
if [ -f "$STATUS_FILE" ]; then
    # 检查 jq 是否安装
    if command -v jq >/dev/null 2>&1; then
        PROFILE_FRESH=$(jq -r '.profile_fresh // "true"' "$STATUS_FILE" 2>/dev/null)

        if [ "$PROFILE_FRESH" = "false" ]; then
            echo -e "${YELLOW}⚠️  用户画像可能过期${NC}"
            echo "建议运行: /user-profile 更新画像"
        fi

        # 读取并显示用户信息
        NAME=$(jq -r '.user_name // ""' "$STATUS_FILE" 2>/dev/null)
        ROLE=$(jq -r '.user_role // ""' "$STATUS_FILE" 2>/dev/null)
        SKILLS_COUNT=$(jq -r '.skills_count // 0' "$STATUS_FILE" 2>/dev/null)

        if [ -n "$NAME" ]; then
            echo -e "${GREEN}✅ 用户画像已加载${NC}: $NAME ($ROLE)"
            echo "   当前掌握 $SKILLS_COUNT 个用户技能"
        else
            # 回退到直接读取 profile 文件
            NAME=$(jq -r '.basic_info.name // "未设置"' "$PROFILE_FILE" 2>/dev/null)
            ROLE=$(jq -r '.basic_info.role // "未设置"' "$PROFILE_FILE" 2>/dev/null)
            SKILLS_COUNT=$(jq -r '.user_skills | length' "$PROFILE_FILE" 2>/dev/null || echo "0")

            echo -e "${GREEN}✅ 用户画像已加载${NC}: $NAME ($ROLE)"
            echo "   当前掌握 $SKILLS_COUNT 个用户技能"
        fi
    else
        echo -e "${GREEN}✅ 用户画像已加载${NC}"
        echo "   (安装 jq 以显示详细信息)"
    fi
else
    # 回退：直接读取 profile 文件
    if command -v jq >/dev/null 2>&1; then
        NAME=$(jq -r '.basic_info.name // "未设置"' "$PROFILE_FILE" 2>/dev/null)
        ROLE=$(jq -r '.basic_info.role // "未设置"' "$PROFILE_FILE" 2>/dev/null)
        SKILLS_COUNT=$(jq -r '.user_skills | length' "$PROFILE_FILE" 2>/dev/null || echo "0")

        echo -e "${GREEN}✅ 用户画像已加载${NC}: $NAME ($ROLE)"
        echo "   当前掌握 $SKILLS_COUNT 个用户技能"
    else
        echo -e "${GREEN}✅ 用户画像已加载${NC}"
        echo "   (安装 jq 以显示详细信息)"
    fi
fi

exit 0
