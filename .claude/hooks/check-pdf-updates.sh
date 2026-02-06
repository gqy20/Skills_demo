#!/bin/bash
# Hook: 检查 PDF 文件更新
# 在每次用户输入前检查 01_articles/ 目录是否有新的 PDF 文件

set -e

# 加载共享库
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

# 初始化
init_colors
CYAN='\033[0;36m'  # 添加 CYAN 颜色
DIM='\033[2m'      # 添加 DIM 颜色
check_jq || exit 0

# 配置
# 如果 CLAUDE_PROJECT_DIR 未设置，从脚本路径推导
PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
PDF_DIR="$PROJECT_ROOT/01_articles"
STATUS_FILE="$PROJECT_ROOT/.info/.pdf_status"
ALERT_FILE="$PROJECT_ROOT/.info/.pdf_alert"

# 确保 .info 目录存在
mkdir -p "$(dirname "$STATUS_FILE")"

# 1. 获取当前 PDF 文件列表和状态
get_pdf_info() {
    if [ ! -d "$PDF_DIR" ]; then
        return
    fi

    # 获取所有 PDF 文件及其修改时间
    find "$PDF_DIR" -type f -name "*.pdf" -printf "%P|%T@\n" 2>/dev/null | sort
}

# 2. 对比状态，检测变化
check_pdf_changes() {
    local new_pdfs=()
    local modified_pdfs=()
    local has_changes=false

    # 读取上次状态
    declare -A last_state
    if [ -f "$STATUS_FILE" ]; then
        while IFS='|' read -r name mtime; do
            last_state["$name"]="$mtime"
        done < "$STATUS_FILE"
    fi

    # 检查当前状态
    while IFS='|' read -r name mtime; do
        if [ -z "${last_state[$name]}" ]; then
            new_pdfs+=("$name")
            has_changes=true
        elif [ "${last_state[$name]}" != "$mtime" ]; then
            modified_pdfs+=("$name")
            has_changes=true
        fi
    done < <(get_pdf_info)

    # 更新状态文件
    get_pdf_info > "$STATUS_FILE"

    # 返回结果
    if [ "$has_changes" = true ]; then
        echo "CHANGES_DETECTED"
        if [ ${#new_pdfs[@]} -gt 0 ]; then
            echo "NEW:${new_pdfs[@]}"
        fi
        if [ ${#modified_pdfs[@]} -gt 0 ]; then
            echo "MODIFIED:${modified_pdfs[@]}"
        fi
    fi
}

# 3. 检查是否有正在处理的 PDF
check_processing_status() {
    if [ -f "$ALERT_FILE" ]; then
        local alert_time=$(cat "$ALERT_FILE" 2>/dev/null || echo "0")
        local current_time=$(date +%s)
        local elapsed=$((current_time - alert_time))

        # 5分钟内的提示才显示
        if [ $elapsed -lt 300 ]; then
            return 0  # 有正在处理的提示
        fi
    fi
    return 1
}

# 4. 显示 PDF 更新提示
show_pdf_alert() {
    local result=$(check_pdf_changes)

    if [ -z "$result" ]; then
        return
    fi

    echo ""
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}📄 检测到 PDF 文件变化${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

    local new_count=0
    local modified_count=0

    while IFS= read -r line; do
        if [ "$line" = "CHANGES_DETECTED" ]; then
            continue
        fi
        if [[ "$line" == NEW:* ]]; then
            local files="${line#NEW:}"
            for file in $files; do
                echo -e "  ${GREEN}+${NC} 新文件: $file"
                ((new_count++))
            done
        elif [[ "$line" == MODIFIED:* ]]; then
            local files="${line#MODIFIED:}"
            for file in $files; do
                echo -e "  ${YELLOW}~${NC} 修改: $file"
                ((modified_count++))
            done
        fi
    done <<< "$result"

    echo ""
    echo -e "  ${DIM}提示: 使用 PDF 处理工具转换这些文件${NC}"
    echo ""

    # 记录提示时间
    date +%s > "$ALERT_FILE"
}

# 5. 显示处理状态提示
show_processing_alert() {
    if check_processing_status; then
        echo -e "${DIM}  💡 有 PDF 文件正在处理或待处理${NC}"
    fi
}

# 主逻辑
# 只有当 PDF 目录存在时才执行
if [ -d "$PDF_DIR" ]; then
    # 显示变更提示
    show_pdf_alert
fi

exit 0
