#!/bin/bash
# Hook: 归档低频使用的技能
# 用法: archive-low-frequency-skills.sh [--type=user|proven|task] [--count=N]
# 作用: 根据 usage_count 归档低频技能

set -e

# 加载共享库
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

# 初始化
init_colors
check_jq || { echo -e "${YELLOW}⚠️  需要安装 jq: brew install jq 或 apt install jq${NC}" && exit 1; }

# 默认参数
ARCHIVE_TYPE="auto"  # auto, user, proven, task
ARCHIVE_COUNT=1      # 默认归档 1 个
DRY_RUN=false

# 解析参数
while [[ $# -gt 0 ]]; do
    case $1 in
        --type)
            ARCHIVE_TYPE="$2"
            shift 2
            ;;
        --count)
            ARCHIVE_COUNT="$2"
            shift 2
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --help)
            echo "用法: archive-low-frequency-skills.sh [选项]"
            echo ""
            echo "选项:"
            echo "  --type TYPE    归档类型: auto, user, proven, task (默认: auto)"
            echo "  --count N      归档数量 (默认: 1)"
            echo "  --dry-run      预览模式，不实际执行"
            echo "  --help         显示此帮助"
            echo ""
            echo "示例:"
            echo "  archive-low-frequency-skills.sh --type=user --count=1"
            echo "  archive-low-frequency-skills.sh --dry-run"
            exit 0
            ;;
        *)
            echo "未知参数: $1"
            echo "使用 --help 查看帮助"
            exit 1
            ;;
    esac
done

# 获取当前技能数量
U_COUNT=$(get_skill_count "user")
P_COUNT=$(get_skill_count "proven")
K_COUNT=$(get_skill_count "task")

echo -e "${BLUE}📊 当前技能统计${NC}"
echo -e "  u_ 技能: ${GREEN}$U_COUNT${NC}"
echo -e "  p_ 技能: ${GREEN}$P_COUNT${NC}"
echo -e "  k_ 技能: ${GREEN}$K_COUNT${NC}"
echo ""

# 确定要归档的技能类型
if [ "$ARCHIVE_TYPE" = "auto" ]; then
    # 自动判断：优先归档超过阈值的类型
    if [ "$U_COUNT" -gt 5 ]; then
        ARCHIVE_TYPE="user"
    elif [ "$P_COUNT" -gt 10 ]; then
        ARCHIVE_TYPE="proven"
    elif [ "$K_COUNT" -gt 20 ]; then
        ARCHIVE_TYPE="task"
    else
        # 都没有超限，归档使用次数最少的
        echo -e "${BLUE}ℹ️  技能数量未超限，将归档使用次数最少的技能${NC}"
        # 找出 usage_count 最少的技能类型
        # 这里简化处理：默认归档 task 类型
        ARCHIVE_TYPE="task"
    fi
fi

# 获取要归档的技能前缀
case "$ARCHIVE_TYPE" in
    user)
        PREFIX="u_"
        SOURCE_FIELD="user_skills"
        ;;
    proven)
        PREFIX="p_"
        SOURCE_FIELD="proven_skills"
        ;;
    task)
        PREFIX="k_"
        SOURCE_FIELD=""  # k_ 技能不在 tasks.json 中单独记录
        ;;
    *)
        echo -e "${YELLOW}⚠️  未知的归档类型: $ARCHIVE_TYPE${NC}"
        exit 1
        ;;
esac

echo -e "${BLUE}🎯 归档类型: $ARCHIVE_TYPE ($PREFIX)${NC}"
echo ""

# 查找低频技能
LOW_USAGE_SKILLS=()

if [ "$ARCHIVE_TYPE" = "task" ]; then
    # k_ 技能：遍历目录，检查是否有对应的 p_ 版本
    for skill_dir in "$SKILLS_DIR"/${PREFIX}*; do
        if [ -d "$skill_dir" ]; then
            skill_name=$(basename "$skill_dir")
            # 检查是否有对应的 p_ 版本
            base_name=$(echo "$skill_name" | sed "s/^k[0-9]*_//")
            p_version=$(find "$SKILLS_DIR" -maxdepth 1 -type d -name "p_${base_name}" 2>/dev/null)

            if [ -n "$p_version" ]; then
                # 已有 p_ 版本，优先归档 k_ 版本
                LOW_USAGE_SKILLS+=("$skill_name:has_p_version")
            fi
        fi
    done
else
    # u_ 和 p_ 技能：从 tasks.json 读取 usage_count
    if [ -n "$SOURCE_FIELD" ] && json_read "$TASKS_FILE" ".$SOURCE_FIELD" >/dev/null 2>&1; then
        # 按 usage_count 排序，取最低的
        while IFS= read -r skill_name; do
            usage_count=$(json_read "$TASKS_FILE" ".$SOURCE_FIELD[\"$skill_name\"].usage_count // 0")
            LOW_USAGE_SKILLS+=("$skill_name:$usage_count")
        done < <(jq -r ".$SOURCE_FIELD | to_entries[] | select(.key | startswith(\"$PREFIX\")) | .key" "$TASKS_FILE" 2>/dev/null)

        # 按 usage_count 排序
        IFS=$'\n' LOW_USAGE_SKILLS=($(sort -t':' -k2 -n <<<"${LOW_USAGE_SKILLS[*]}"))
        unset IFS
    fi
fi

# 显示待归档技能
if [ ${#LOW_USAGE_SKILLS[@]} -eq 0 ]; then
    echo -e "${YELLOW}⚠️  没有找到可归档的 $PREFIX 技能${NC}"
    exit 0
fi

echo -e "${BLUE}📋 待归档技能 (按使用频率排序):${NC}"
for i in "${!LOW_USAGE_SKILLS[@]}"; do
    if [ $i -ge "$ARCHIVE_COUNT" ]; then
        break
    fi
    skill_info="${LOW_USAGE_SKILLS[$i]}"
    skill_name=$(echo "$skill_info" | cut -d':' -f1)
    skill_reason=$(echo "$skill_info" | cut -d':' -f2)

    if [ "$skill_reason" = "has_p_version" ]; then
        reason="已有 p_ 版本"
    else
        reason="使用次数: $skill_reason"
    fi

    echo -e "  ${YELLOW}$((i+1)).${NC} $skill_name ${GRAY}($reason)${NC}"
done
echo ""

# 执行归档
if [ "$DRY_RUN" = true ]; then
    echo -e "${BLUE}🔍 预览模式，不实际执行归档${NC}"
    echo -e "${YELLOW}💡 去掉 --dry-run 参数执行实际归档${NC}"
    exit 0
fi

# 确认
echo -e "${YELLOW}⚠️  即将归档上述 $ARCHIVE_COUNT 个技能${NC}"
echo -e "${YELLOW}归档后的技能将移动到: $ARCHIVE_DIR/${NC}"
echo ""

TIMESTAMP=$(get_timestamp)

# 创建归档记录
ARCHIVE_LOG="$ARCHIVE_DIR/.archive_log.json"
mkdir -p "$ARCHIVE_DIR"

# 初始化归档日志
if [ ! -f "$ARCHIVE_LOG" ]; then
    echo '{"archived_skills": []}' > "$ARCHIVE_LOG"
fi

for i in $(seq 0 $((ARCHIVE_COUNT - 1))); do
    if [ $i -ge ${#LOW_USAGE_SKILLS[@]} ]; then
        break
    fi

    skill_info="${LOW_USAGE_SKILLS[$i]}"
    skill_name=$(echo "$skill_info" | cut -d':' -f1)
    skill_dir="$SKILLS_DIR/$skill_name"

    if [ ! -d "$skill_dir" ]; then
        echo -e "${YELLOW}⚠️  技能目录不存在: $skill_name${NC}"
        continue
    fi

    # 移动到归档目录
    archived_dir="$ARCHIVE_DIR/$skill_name"
    mv "$skill_dir" "$archived_dir"

    # 记录到归档日志
    jq --arg name "$skill_name" \
       --arg type "$ARCHIVE_TYPE" \
       --arg time "$TIMESTAMP" \
       '.archived_skills += [{"name": $name, "type": $type, "archived_at": $time}]' \
       "$ARCHIVE_LOG" > "${ARCHIVE_LOG}.tmp" && mv "${ARCHIVE_LOG}.tmp" "$ARCHIVE_LOG"

    # 从 tasks.json 中移除（如果是 u_ 或 p_ 技能）
    if [ "$ARCHIVE_TYPE" != "task" ] && [ -n "$SOURCE_FIELD" ]; then
        atomic_json_update "$TASKS_FILE" --arg name "$skill_name" "del(.$SOURCE_FIELD[\"\$name\"])"
    fi

    echo -e "${GREEN}✅ 已归档${NC}: $skill_name → $archived_dir"
done

# 清除归档待处理标记
if [ -f "$TASKS_FILE" ]; then
    atomic_json_update "$TASKS_FILE" '.archive_pending = false'
fi

echo ""
echo -e "${GREEN}✅ 归档完成${NC}"
echo -e "${BLUE}归档日志${NC}: $ARCHIVE_LOG"
echo -e "${YELLOW}💡 恢复技能: mv $ARCHIVE_DIR/<skill_name> $SKILLS_DIR/${NC}"

exit 0
