#!/bin/bash
# SessionStart Hook - 自动检查用户画像新鲜度

set -e

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
PROFILE_FILE="$PROJECT_DIR/.info/usr.json"
INFO_DIR="$PROJECT_DIR/info"

# 颜色输出
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查画像是否存在
if [ ! -f "$PROFILE_FILE" ]; then
    echo -e "${YELLOW}⚠️  用户画像不存在${NC}"
    echo "建议运行: /user-profile 生成画像"
    exit 0
fi

# 检查 info/ 目录是否有新文件
if [ -d "$INFO_DIR" ]; then
    # 获取 info/ 目录中支持的文件类型
    LATEST_INFO=$(find "$INFO_DIR" -type f \( -name "*.md" -o -name "*.json" -o -name "*.pdf" -o -name "*.txt" \) 2>/dev/null | xargs ls -t 2>/dev/null | head -1)

    if [ -n "$LATEST_INFO" ]; then
        # 获取文件修改时间（兼容 macOS 和 Linux）
        if stat -f %m "$LATEST_INFO" >/dev/null 2>&1; then
            INFO_MTIME=$(stat -f %m "$LATEST_INFO")
        else
            INFO_MTIME=$(stat -c %Y "$LATEST_INFO" 2>/dev/null)
        fi

        # 获取画像修改时间
        if stat -f %m "$PROFILE_FILE" >/dev/null 2>&1; then
            PROFILE_MTIME=$(stat -f %m "$PROFILE_FILE")
        else
            PROFILE_MTIME=$(stat -c %Y "$PROFILE_FILE" 2>/dev/null)
        fi

        # 比较时间
        if [ -n "$INFO_MTIME" ] && [ -n "$PROFILE_MTIME" ] && [ "$INFO_MTIME" -gt "$PROFILE_MTIME" ]; then
            echo -e "${YELLOW}⚠️  检测到 info/ 目录有新文件${NC}"
            echo "最新文件: $(basename "$LATEST_INFO")"
            echo "建议运行: /user-profile 更新画像"
        fi
    fi
fi

# 输出画像摘要
if [ -f "$PROFILE_FILE" ]; then
    # 检查 jq 是否安装
    if command -v jq >/dev/null 2>&1; then
        NAME=$(jq -r '.basic_info.name // "未设置"' "$PROFILE_FILE" 2>/dev/null)
        ROLE=$(jq -r '.basic_info.role // "未设置"' "$PROFILE_FILE" 2>/dev/null)

        # 计算 u_ 技能数量
        U_SKILLS_COUNT=$(jq -r '.user_skills | length' "$PROFILE_FILE" 2>/dev/null || echo "0")

        echo -e "${GREEN}✅ 用户画像已加载${NC}: $NAME ($ROLE)"
        echo "   当前掌握 $U_SKILLS_COUNT 个用户技能"
    else
        echo -e "${GREEN}✅ 用户画像已加载${NC}"
        echo "   (安装 jq 以显示详细信息)"
    fi
fi

exit 0
