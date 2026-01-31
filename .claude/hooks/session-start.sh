#!/bin/bash
# SessionStart Hook - 显示用户画像状态（从 .status.json 读取）

set -e

# 加载共享库
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

# 初始化
init_colors

# 首先更新状态（调用 update-status.sh 执行检查逻辑）
UPDATE_HOOK="$SCRIPT_DIR/update-status.sh"
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
    if check_jq; then
        PROFILE_FRESH=$(json_read "$STATUS_FILE" '.profile_fresh // "true"')

        if [ "$PROFILE_FRESH" = "false" ]; then
            echo -e "${YELLOW}⚠️  用户画像可能过期${NC}"
            echo "建议运行: /user-profile 更新画像"
        fi

        # 读取并显示用户信息
        NAME=$(json_read "$STATUS_FILE" '.user_name // ""')
        ROLE=$(json_read "$STATUS_FILE" '.user_role // ""')
        SKILLS_COUNT=$(json_read "$STATUS_FILE" '.skills_count // "0"')

        if [ -n "$NAME" ]; then
            echo -e "${GREEN}✅ 用户画像已加载${NC}: $NAME ($ROLE)"
            echo "   当前掌握 $SKILLS_COUNT 个用户技能"
        else
            # 回退到直接读取 profile 文件
            NAME=$(json_read "$PROFILE_FILE" '.basic_info.name // "未设置"')
            ROLE=$(json_read "$PROFILE_FILE" '.basic_info.role // "未设置"')
            SKILLS_COUNT=$(json_read "$PROFILE_FILE" '.user_skills | length // "0"')

            echo -e "${GREEN}✅ 用户画像已加载${NC}: $NAME ($ROLE)"
            echo "   当前掌握 $SKILLS_COUNT 个用户技能"
        fi
    else
        echo -e "${GREEN}✅ 用户画像已加载${NC}"
        echo "   (安装 jq 以显示详细信息)"
    fi
else
    # 回退：直接读取 profile 文件
    if check_jq; then
        NAME=$(json_read "$PROFILE_FILE" '.basic_info.name // "未设置"')
        ROLE=$(json_read "$PROFILE_FILE" '.basic_info.role // "未设置"')
        SKILLS_COUNT=$(json_read "$PROFILE_FILE" '.user_skills | length // "0"')

        echo -e "${GREEN}✅ 用户画像已加载${NC}: $NAME ($ROLE)"
        echo "   当前掌握 $SKILLS_COUNT 个用户技能"
    else
        echo -e "${GREEN}✅ 用户画像已加载${NC}"
        echo "   (安装 jq 以显示详细信息)"
    fi
fi

exit 0
