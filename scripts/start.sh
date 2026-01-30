#!/bin/bash

# Skills Demo 一键开始脚本
# 用途：首次使用时快速配置环境

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo ""
echo -e "${CYAN}╔════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   Skills Demo 一键开始                ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════╝${NC}"
echo ""

# 1. 检查并安装 Claude Code
echo -e "${BLUE}[1/5]${NC} 检查 Claude Code..."
if command -v claude &> /dev/null; then
    echo -e "${GREEN}✓${NC} Claude Code 已安装: $(claude --version 2>/dev/null || echo 'ok')"
else
    echo -e "${CYAN}→${NC} 正在安装 Claude Code（官方 Native Install）..."
    curl -fsSL https://claude.ai/install.sh | bash
    echo -e "${GREEN}✓${NC} 安装完成"
fi

# 2. 检查并安装 uv
echo ""
echo -e "${BLUE}[2/5]${NC} 检查 uv..."
if command -v uv &> /dev/null; then
    echo -e "${GREEN}✓${NC} uv 已安装: $(uv --version 2>/dev/null || echo 'ok')"
else
    echo -e "${CYAN}→${NC} 正在安装 uv..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    echo -e "${GREEN}✓${NC} 安装完成"
fi

# 3. 清理示例技能
echo ""
echo -e "${BLUE}[3/5]${NC} 清理示例技能..."
if ls .claude/skills/k[0-9]* 2>/dev/null; then
    rm -rf .claude/skills/k[0-9]*
    echo -e "${GREEN}✓${NC} 已删除示例技能"
else
    echo -e "${GREEN}✓${NC} 无需清理"
fi

# 4. 清理旧数据
echo ""
echo -e "${BLUE}[4/5]${NC} 清理旧数据..."
rm -f .info/usr.json .info/tasks.json
rm -rf results
echo -e "${GREEN}✓${NC} 清理完成"

# 5. 初始化 tasks.json
echo ""
echo -e "${BLUE}[5/5]${NC} 初始化配置..."
if [ ! -f ".info/tasks.json" ]; then
    echo '{"next_id": 1, "tasks": {}, "user_skills": {}, "archived_u_skills": []}' > .info/tasks.json
    echo -e "${GREEN}✓${NC} 已创建 tasks.json"
else
    echo -e "${GREEN}✓${NC} tasks.json 已存在"
fi

# 完成
echo ""
echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║      配置完成！                       ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
echo ""
echo "下一步："
echo "  1. ${CYAN}上传个人信息${NC} → 将文件拖入 info/ 目录"
echo "  2. ${CYAN}生成用户画像${NC} → 在 Claude Code 中运行: ${YELLOW}/user-profile${NC}"
echo "  3. ${CYAN}启动任务${NC}     → 在 Claude Code 中运行: ${YELLOW}/commander start [任务描述]${NC}"
echo ""
