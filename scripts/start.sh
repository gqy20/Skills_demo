#!/bin/bash

# Skills Demo 一键开始脚本
# 用途：首次使用时快速配置环境

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo ""
echo -e "${CYAN}╔════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   Skills Demo 一键开始                ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════╝${NC}"
echo ""

# 1. 配置 Claude Code LLM
echo -e "${BLUE}[1/8]${NC} 配置 Claude Code LLM 提供商..."
echo ""
echo -e "${CYAN}══════════════════════════════════════════${NC}"
echo -e "${CYAN}     选择 Claude Code 使用的 LLM 服务${NC}"
echo -e "${CYAN}══════════════════════════════════════════${NC}"
echo ""
echo "可选服务："
echo "  1) ${YELLOW}智谱 GLM (Zhipu)${NC}      - 国内访问快速，支持 Coding Plan"
echo "  2) ${YELLOW}Minimax${NC}              - 国内访问快速，支持 Coding Plan"
echo "  3) ${YELLOW}Anthropic Claude${NC}     - 官方服务（需要代理）"
echo "  4) ${YELLOW}跳过${NC}                  - 使用 Claude Code 默认配置"
echo ""

while true; do
    echo -n "请选择 [1-4]: "
    read -r choice
    case $choice in
        1)
            llm_provider="zhipu"
            llm_name="智谱 GLM"
            llm_base_url="https://open.bigmodel.cn/api/paas/v4/"
            llm_model="glm-4-plus"
            break
            ;;
        2)
            llm_provider="minimax"
            llm_name="Minimax"
            llm_base_url="https://api.minimax.chat/v1/"
            llm_model="deepseek-chat"
            break
            ;;
        3)
            llm_provider="anthropic"
            llm_name="Anthropic Claude"
            llm_base_url="https://api.anthropic.com"
            llm_model="claude-sonnet-4-5-20250929"
            break
            ;;
        4)
            llm_provider="skip"
            llm_name="跳过"
            break
            ;;
        *)
            echo -e "${YELLOW}无效选择，请输入 1-4${NC}"
            ;;
    esac
done

if [ "$llm_provider" != "skip" ]; then
    echo ""
    echo -e "${YELLOW}已选择: $llm_name${NC}"
    echo "  Base URL: $llm_base_url"
    echo "  Model: $llm_model"
    echo ""
    echo -n "请输入 API Key: "
    read -r llm_api_key

    if [ -n "$llm_api_key" ]; then
        # 写入 .env 文件
        if [ ! -f .env ]; then
            touch .env
        fi

        # 检查是否已有 CLAUDE 配置
        if grep -q "^CLAUDE_API_KEY=" .env 2>/dev/null; then
            echo ""
            echo -e "${YELLOW}检测到已存在 CLAUDE_API_KEY 配置${NC}"
            echo -n "是否覆盖? [y/N]: "
            read -r overwrite
            if [[ ! "$overwrite" =~ ^[Yy]$ ]]; then
                echo -e "${GREEN}✓${NC} 保留现有配置"
            else
                # 删除旧配置
                sed -i '/^CLAUDE_API_KEY=/d' .env
                sed -i '/^CLAUDE_BASE_URL=/d' .env
                sed -i '/^CLAUDE_MODEL=/d' .env
                sed -i '/^# Claude Code LLM 配置/,/^$/d' .env

                # 添加新配置
                echo "" >> .env
                echo "# Claude Code LLM 配置" >> .env
                echo "CLAUDE_API_KEY=\"$llm_api_key\"" >> .env
                echo "CLAUDE_BASE_URL=$llm_base_url" >> .env
                echo "CLAUDE_MODEL=$llm_model" >> .env
                echo -e "${GREEN}✓${NC} Claude Code LLM 配置已保存"
            fi
        else
            echo "" >> .env
            echo "# Claude Code LLM 配置" >> .env
            echo "CLAUDE_API_KEY=\"$llm_api_key\"" >> .env
            echo "CLAUDE_BASE_URL=$llm_base_url" >> .env
            echo "CLAUDE_MODEL=$llm_model" >> .env
            echo -e "${GREEN}✓${NC} Claude Code LLM 配置已保存"
        fi
    else
        echo -e "${YELLOW}⚠️  API Key 未输入，跳过配置${NC}"
    fi
else
    echo -e "${GREEN}✓${NC} 跳过 Claude Code LLM 配置"
fi

# 2. 检查并安装 Claude Code
echo ""
echo -e "${BLUE}[2/8]${NC} 检查 Claude Code..."
if command -v claude &> /dev/null; then
    echo -e "${GREEN}✓${NC} Claude Code 已安装: $(claude --version 2>/dev/null || echo 'ok')"
else
    echo -e "${CYAN}→${NC} 正在安装 Claude Code（官方 Native Install）..."
    curl -fsSL https://claude.ai/install.sh | bash
    echo -e "${GREEN}✓${NC} 安装完成"
fi

# 3. 检查并安装 uv
echo ""
echo -e "${BLUE}[3/8]${NC} 检查 uv..."
if command -v uv &> /dev/null; then
    echo -e "${GREEN}✓${NC} uv 已安装: $(uv --version 2>/dev/null || echo 'ok')"
else
    echo -e "${CYAN}→${NC} 正在安装 uv..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    echo -e "${GREEN}✓${NC} 安装完成"
fi

# 4. 清理技能文件
echo ""
echo -e "${BLUE}[4/8]${NC} 清理技能文件..."

# 删除所有 k_ 开头的技能（包括 k1, k2, k_* 等）
if ls .claude/skills/k* 2>/dev/null; then
    rm -rf .claude/skills/k*
    echo -e "${GREEN}✓${NC} 已删除 k_* 技能"
fi

# 删除所有 u_ 开头的技能
if ls .claude/skills/u_* 2>/dev/null; then
    rm -rf .claude/skills/u_*
    echo -e "${GREEN}✓${NC} 已删除 u_* 技能"
fi

# 删除所有 p_ 开头的技能
if ls .claude/skills/p_* 2>/dev/null; then
    rm -rf .claude/skills/p_*
    echo -e "${GREEN}✓${NC} 已删除 p_* 技能"
fi

# 如果没有任何技能被清理，显示无需清理
if ! ls .claude/skills/k* .claude/skills/u_* .claude/skills/p_* 2>/dev/null | grep -q .; then
    echo -e "${GREEN}✓${NC} 无需清理"
fi

# 5. 清理旧数据
echo ""
echo -e "${BLUE}[5/8]${NC} 清理旧数据..."
rm -rf .info results
echo -e "${GREEN}✓${NC} 清理完成"

# 6. 初始化配置
echo ""
echo -e "${BLUE}[6/8]${NC} 初始化配置..."
mkdir -p .info
cp .templates/info.md .info/
echo '{"next_id": 1, "tasks": {}, "user_skills": {}, "proven_skills": {}, "archived_u_skills": []}' > .info/tasks.json
echo -e "${GREEN}✓${NC} 已创建 tasks.json 并复制 info.md"

# 7. 配置 API Keys
echo ""
echo -e "${BLUE}[7/8]${NC} 配置 PDF 处理 API Keys..."
echo ""
echo -e "${CYAN}══════════════════════════════════════════${NC}"
echo -e "${CYAN}         PDF 处理功能需要配置 API Keys${NC}"
echo -e "${CYAN}══════════════════════════════════════════${NC}"
echo ""

# 检查是否已有 PDF API 配置
if grep -q "^MINERU_API_KEY=" .env 2>/dev/null; then
    echo -e "${YELLOW}检测到已存在的 PDF API 配置${NC}"
    echo -n "是否重新配置? [y/N]: "
    read -r response
    if [[ ! "$response" =~ ^[Yy]$ ]]; then
        echo -e "${GREEN}✓${NC} 跳过 PDF API 配置"
        pdf_configured=true
    else
        # 删除旧配置
        sed -i '/^MINERU_API_KEY=/d' .env
        sed -i '/^ANTHROPIC_AUTH_TOKEN=/d' .env
        sed -i '/^ANTHROPIC_MODEL=/d' .env
        sed -i '/^ANTHROPIC_BASE_URL=/d' .env
        sed -i '/^# MinerU API/,^$/d' .env
        sed -i '/^# Anthropic Claude API/,^$/d' .env
        pdf_configured=false
    fi
else
    pdf_configured=false
fi

if [ "$pdf_configured" = false ]; then
    echo ""
    echo -e "${YELLOW}[必需] MinerU API Key${NC}"
    echo "  用于: PDF 转 Markdown"
    echo "  获取: https://mineru.net/apiManage"
    echo ""
    while [ -z "$MINERU_API_KEY" ]; do
        echo -n "请输入 MinerU API Key: "
        read -r MINERU_API_KEY
        if [ -z "$MINERU_API_KEY" ]; then
            echo -e "${YELLOW}⚠️  API Key 不能为空${NC}"
        fi
    done

    echo ""
    echo -e "${YELLOW}[可选] Anthropic API Key${NC}"
    echo "  用于: AI 生成论文摘要（中文）"
    echo "  获取: https://console.anthropic.com/"
    echo ""
    echo -n "请输入 Anthropic API Key (直接回车跳过): "
    read -r ANTHROPIC_API_KEY

    # 写入 .env 文件
    echo "" >> .env
    echo "# MinerU API (必需 - 用于 PDF 转 Markdown)" >> .env
    echo "MINERU_API_KEY=\"$MINERU_API_KEY\"" >> .env
    echo "" >> .env
    if [ -n "$ANTHROPIC_API_KEY" ]; then
        echo "# Anthropic Claude API (可选 - 用于生成摘要)" >> .env
        echo "ANTHROPIC_AUTH_TOKEN=\"$ANTHROPIC_API_KEY\"" >> .env
        echo "ANTHROPIC_MODEL=claude-sonnet-4-5-20250929" >> .env
        echo "ANTHROPIC_BASE_URL=https://api.anthropic.com" >> .env
        echo "" >> .env
    fi
    echo "# PDF 并行处理配置" >> .env
    echo "PDF_MAX_WORKERS=5" >> .env
    echo "PDF_ENABLE_PARALLEL=true" >> .env

    echo -e "${GREEN}✓${NC} PDF API Keys 已保存"
fi

# 8. 配置任务完成提示
echo ""
echo -e "${BLUE}[8/8]${NC} 配置任务完成提示..."
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # 安装 aplay 用于声音提示
    if command -v aplay >/dev/null 2>&1; then
        echo -e "${GREEN}✓${NC} aplay 已安装"
    else
        echo -e "${CYAN}→${NC} 正在安装 alsa-utils（任务完成提示音）..."
        if command -v apt-get >/dev/null 2>&1; then
            sudo apt-get update -qq && sudo apt-get install -y alsa-utils >/dev/null 2>&1
        elif command -v dnf >/dev/null 2>&1; then
            sudo dnf install -y alsa-utils >/dev/null 2>&1
        elif command -v pacman >/dev/null 2>&1; then
            sudo pacman -S --noconfirm alsa-utils >/dev/null 2>&1
        else
            echo -e "${YELLOW}⚠️  请手动安装: sudo apt install alsa-utils${NC}"
        fi
        if command -v aplay >/dev/null 2>&1; then
            echo -e "${GREEN}✓${NC} 安装完成"
        else
            echo -e "${YELLOW}⚠️  安装失败，将仅使用终端提示${NC}"
        fi
    fi
    # 检查系统声音文件
    if [ -d "/usr/share/sounds/freedesktop/stereo" ]; then
        echo -e "${GREEN}✓${NC} 系统声音文件可用"
    else
        echo -e "${YELLOW}⚠️  系统声音文件不存在，将使用简单提示音${NC}"
    fi
elif [[ "$OSTYPE" == "darwin"* ]]; then
    echo -e "${GREEN}✓${NC} macOS 使用系统通知"
else
    echo -e "${YELLOW}⚠️  未知平台: $OSTYPE${NC}"
fi

echo -e "${CYAN}→${NC} 任务完成时将播放提示音并显示终端横幅"

# 完成
echo ""
echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║      配置完成！                       ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
echo ""
echo "下一步："
echo "  1. ${CYAN}上传个人信息${NC}      → 将文件拖入 info/ 目录"
echo "  2. ${CYAN}生成用户画像${NC}      → 运行: ${YELLOW}/user-profile${NC}"
echo "  3. ${CYAN}添加 PDF 文件${NC}     → 将 PDF 放入 01_articles/ 目录"
echo "  4. ${CYAN}处理 PDF 文件${NC}     → 运行: ${YELLOW}/pdf_processor${NC}"
echo "  5. ${CYAN}启动任务${NC}          → 运行: ${YELLOW}/commander start [描述]${NC}"
echo ""
echo -e "${CYAN}💡 提示: 每次对话开始时会自动检测 01_articles/ 中的 PDF 变化${NC}"
echo ""
echo -e "${YELLOW}注意: Claude Code LLM 配置已保存到 .env，需手动配置到 ~/.claude/settings.json${NC}"
echo "     或者在 Claude Code 中设置环境变量 CLAUDE_API_KEY, CLAUDE_BASE_URL, CLAUDE_MODEL"
echo ""
