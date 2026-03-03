#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   new_post.sh "topic" [target_dir] [owner]
# Example:
#   new_post.sh "cache invalidation" ~/.exp qy

TOPIC="${1:-}"
TARGET_DIR="${2:-$HOME/.exp}"
OWNER="${3:-}"

if [[ -z "$TOPIC" ]]; then
  echo "Usage: $0 \"topic\" [target_dir] [owner]" >&2
  exit 1
fi

if ! command -v tr >/dev/null 2>&1; then
  echo "Required command 'tr' not found" >&2
  exit 1
fi

DATE_DASH="$(date +%F)"
DATE_COMPACT="$(date +%Y%m%d)"
gen_shortid() {
  hexdump -n 2 -e '/1 "%02x"' /dev/urandom
}

SHORTID="$(gen_shortid)"
SLUG="$(printf '%s' "$TOPIC" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')"

if [[ -z "$SLUG" ]]; then
  SLUG="note"
fi

mkdir -p "$TARGET_DIR"

FILE="$TARGET_DIR/${DATE_DASH}-${SLUG}-${SHORTID}.md"
while [[ -e "$FILE" ]]; do
  SHORTID="$(gen_shortid)"
  FILE="$TARGET_DIR/${DATE_DASH}-${SLUG}-${SHORTID}.md"
done

TITLE="[$SLUG] ${TOPIC}"
ID="exp-${DATE_COMPACT}-${SHORTID}"

cat > "$FILE" <<EOM
---
id: ${ID}
title: "${TITLE}"
date: ${DATE_DASH}
doc_type: postmortem
status: draft
owner: "${OWNER}"
tags: []
summary: ""
impact: ""
root_cause: ""
actions: ""
evidence_links: []
reviewer: ""
severity: medium
repo: ""
paths: []
last_verified_at: ""
review_date: ""
visibility: team
---

## 1. 背景与目标

## 2. 现象与影响

## 3. 根因分析

## 4. 解决方案

## 5. 验证与结果

## 6. 踩坑与反模式

## 7. Action Items

- [ ] owner: @, due: YYYY-MM-DD, item:

## 8. 关联资料

EOM

echo "$FILE"
