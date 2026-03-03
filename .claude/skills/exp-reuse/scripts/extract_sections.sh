#!/usr/bin/env bash
# 从经验贴中提取指定章节内容
# Usage:
#   extract_sections.sh <file_path> <section1> [section2] ...
# Example:
#   extract_sections.sh ./exp.md "排查时间线" "验证步骤" "rollback"

set -euo pipefail

FILE="$1"
shift

if [[ -z "$FILE" ]]; then
  echo "Usage: $0 <file_path> <section1> [section2] ..." >&2
  exit 1
fi

if [[ ! -f "$FILE" ]]; then
  echo "File not found: $FILE" >&2
  exit 2
fi

# 章节名称映射（支持模糊匹配）
declare -A SECTIONS=(
  ["排查时间线"]="## 3. 排查/思路时间线"
  ["根因分析"]="## 4. 根因分析"
  ["方案对比"]="## 5. 方案对比与决策理由"
  ["最终方案"]="## 6. 最终方案"
  ["验证结果"]="## 7. 验证与结果"
  ["踩坑"]="## 8. 踩坑与反模式"
  ["actions"]="## 9. Action Items"
  ["关联资料"]="## 10. 关联资料"
  ["changes"]="### changes"
  ["prerequisites"]="### prerequisites"
  ["rollback"]="### rollback"
)

extract_section() {
  local file="$1"
  local section="$2"

  # 精确匹配或模糊匹配
  local pattern="${SECTIONS[$section]:-## $section}"

  # 找到章节起始行
  local start_line
  start_line=$(grep -n "^${pattern}$" "$file" 2>/dev/null | head -1 | cut -d: -f1)

  if [[ -z "$start_line" ]]; then
    # 尝试模糊匹配
    start_line=$(grep -ni "^##.*${section}" "$file" 2>/dev/null | head -1 | cut -d: -f1)
  fi

  if [[ -z "$start_line" ]]; then
    echo "[未找到章节: $section]"
    return
  fi

  # 找到下一个 ## 标题或文件末尾
  local end_line
  end_line=$(tail -n +$((start_line + 1)) "$file" | grep -n "^## " | head -1 | cut -d: -f1)

  if [[ -z "$end_line" ]]; then
    # 没有下一个章节，读取到文件末尾
    tail -n +"$start_line" "$file"
  else
    # 计算实际行号
    end_line=$((start_line + end_line - 1))
    sed -n "${start_line},$((end_line - 1))p" "$file"
  fi
}

# 提取每个指定章节
for sect in "$@"; do
  echo "### $sect"
  extract_section "$FILE" "$sect"
  echo ""
done
