#!/bin/bash
# Hook: 将 k_ 技能升级为 p_ 技能
# 用法: promote-to-proven.sh <k_skill_name> <p_skill_name> [description]

set -e

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
TASKS_FILE="$PROJECT_DIR/.info/tasks.json"
SKILLS_DIR="$PROJECT_DIR/.claude/skills"
ARCHIVE_DIR="$PROJECT_DIR/.claude/skills/.archived"

# 颜色输出
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 检查参数
if [ -z "$1" ] || [ -z "$2" ]; then
    echo "用法: promote-to-proven.sh <k_skill_name> <p_skill_name> [description]"
    exit 1
fi

K_SKILL="$1"
P_SKILL="$2"
DESCRIPTION="${3:-从 $K_SKILL 升级的验证技能}"
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# 验证 k_ 技能存在
K_SKILL_DIR="$SKILLS_DIR/$K_SKILL"
if [ ! -d "$K_SKILL_DIR" ]; then
    echo -e "${YELLOW}⚠️  k_ 技能不存在: $K_SKILL${NC}"
    exit 1
fi

# 验证 p_ 技能命名格式
if [[ ! "$P_SKILL" =~ ^p_[a-z_]+$ ]]; then
    echo -e "${YELLOW}⚠️  p_ 技能命名格式错误，应为 p_[name]${NC}"
    exit 1
fi

# 检查 p_ 技能数量上限（10个）
PROVEN_COUNT=$(jq -r 'if .proven_skills then (.proven_skills | length) else 0 end' "$TASKS_FILE" 2>/dev/null || echo "0")
MAX_PROVEN=10

if [ "$PROVEN_COUNT" -ge "$MAX_PROVEN" ]; then
    echo -e "${YELLOW}⚠️  p_ 技能已达上限 ($MAX_PROVEN 个)${NC}"
    echo -e "${BLUE}当前 p_ 技能数${NC}: $PROVEN_COUNT"
    echo ""
    echo "请先归档低频技能："
    echo "  查看技能: jq '.proven_skills' $TASKS_FILE"
    echo "  归档技能: 删除 tasks.json 中的对应条目"
    exit 1
fi

# 检查 p_ 技能是否已存在
P_SKILL_DIR="$SKILLS_DIR/$P_SKILL"
if [ -d "$P_SKILL_DIR" ]; then
    echo -e "${YELLOW}⚠️  p_ 技能已存在: $P_SKILL${NC}"
    echo "如需更新，请先删除现有技能"
    exit 1
fi

# 检查 jq 是否安装
if ! command -v jq >/dev/null 2>&1; then
    echo -e "${YELLOW}⚠️  需要安装 jq: brew install jq 或 apt install jq${NC}"
    exit 1
fi

# 提取任务 ID（从 k_ 技能名）
TASK_ID=$(echo "$K_SKILL" | grep -o '^k[0-9]*' || echo "")

# 1. 创建 p_ 技能目录
mkdir -p "$P_SKILL_DIR"

# 2. 复制并修改 SKILL.md
K_SKILL_MD="$K_SKILL_DIR/SKILL.md"
P_SKILL_MD="$P_SKILL_DIR/SKILL.md"

if [ -f "$K_SKILL_MD" ]; then
    # 读取原内容并修改头部
    sed "s/^name: $K_SKILL/name: $P_SKILL/" "$K_SKILL_MD" | \
    sed "s/^description: .*/description: $DESCRIPTION. 从 $K_SKILL 升级的实战验证技能./" \
    > "$P_SKILL_MD"

    # 在文档开头添加来源说明
    TEMP_FILE=$(mktemp)
    {
        echo "# $P_SKILL"
        echo ""
        echo "> **来源**: 从 \`$K_SKILL\` 升级"
        echo "> **验证时间**: $TIMESTAMP"
        echo "> **原始任务**: ${TASK_ID:-无}"
        echo ""
        echo "---"
        echo ""
        # 跳过原文件的第一行标题，追加其余内容
        tail -n +5 "$P_SKILL_MD"
    } > "$TEMP_FILE"
    mv "$TEMP_FILE" "$P_SKILL_MD"
else
    # 创建基础 SKILL.md
    cat > "$P_SKILL_MD" <<EOF
---
name: $P_SKILL
description: $DESCRIPTION. 从 $K_SKILL 升级的实战验证技能。
---

# $P_SKILL

从 \`$K_SKILL\` 升级而来的验证技能。

## 来源

- **原始技能**: $K_SKILL
- **验证时间**: $TIMESTAMP
- **原始任务**: ${TASK_ID:-无}

## 使用场景

当需要执行与 $K_SKILL 相似的任务时，复用此已验证的技能。
EOF
fi

# 3. 更新 tasks.json
TEMP_FILE=$(mktemp)

# 检查 proven_skills 是否存在
if jq -e '.proven_skills' "$TASKS_FILE" >/dev/null 2>&1; then
    # 已存在，添加新技能
    jq --arg pskill "$P_SKILL" --arg kskill "$K_SKILL" --arg time "$TIMESTAMP" \
        '.proven_skills[$pskill] = {
            "source": $kskill,
            "derived_at": $time,
            "usage_count": 0,
            "related_tasks": (if ($kskill | startswith("k")) then [($kskill | split("_")[0])] else [] end),
            "success_rate": 1.0
        }' "$TASKS_FILE" > "$TEMP_FILE"
else
    # 不存在，创建 proven_skills 对象
    jq --arg pskill "$P_SKILL" --arg kskill "$K_SKILL" --arg time "$TIMESTAMP" \
        '.proven_skills = {} | .proven_skills[$pskill] = {
            "source": $kskill,
            "derived_at": $time,
            "usage_count": 0,
            "related_tasks": (if ($kskill | startswith("k")) then [($kskill | split("_")[0])] else [] end),
            "success_rate": 1.0
        }' "$TASKS_FILE" > "$TEMP_FILE"
fi

mv "$TEMP_FILE" "$TASKS_FILE"

# 4. 可选：归档原始 k_ 技能
ARCHIVED_K_DIR="$ARCHIVE_DIR/$K_SKILL"
mkdir -p "$ARCHIVE_DIR"
mv "$K_SKILL_DIR" "$ARCHIVED_K_DIR" 2>/dev/null || true

# 5. 记录变更日志
CHANGELOG="$PROJECT_DIR/.info/skills_changelog.jsonl"
cat >> "$CHANGELOG" <<EOF
{"timestamp": "$TIMESTAMP", "tool": "Promote", "skill_type": "proven", "skill_name": "$P_SKILL", "source": "$K_SKILL", "path": "$P_SKILL_DIR/SKILL.md"}
EOF

# 输出结果
echo -e "${GREEN}✅ 技能升级完成${NC}"
echo ""
echo -e "${BLUE}源技能${NC}: $K_SKILL"
echo -e "${BLUE}新技能${NC}: $P_SKILL"
echo -e "${BLUE}描述${NC}: $DESCRIPTION"
echo ""
echo -e "${GREEN}已创建${NC}: $P_SKILL_DIR/SKILL.md"
echo -e "${GREEN}已更新${NC}: $TASKS_FILE (proven_skills)"
if [ -d "$ARCHIVED_K_DIR" ]; then
    echo -e "${GREEN}已归档${NC}: $ARCHIVED_K_DIR"
fi

exit 0
