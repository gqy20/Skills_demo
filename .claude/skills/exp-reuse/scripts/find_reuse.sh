#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   find_reuse.sh "query words" [target_dir] [limit]
# Example:
#   find_reuse.sh "cache timeout redis" ./knowledge/exp 5

QUERY="${1:-}"
TARGET_DIR="${2:-$(pwd)/knowledge/exp}"
LIMIT="${3:-5}"

if [[ -z "$QUERY" ]]; then
  echo "Usage: $0 \"query words\" [target_dir] [limit]" >&2
  exit 1
fi

if [[ ! -d "$TARGET_DIR" ]]; then
  echo "target_dir not found: $TARGET_DIR" >&2
  exit 2
fi

if ! [[ "$LIMIT" =~ ^[0-9]+$ ]]; then
  echo "limit must be integer" >&2
  exit 3
fi

lower() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

contains() {
  local haystack needle
  haystack="$(lower "$1")"
  needle="$(lower "$2")"
  [[ "$haystack" == *"$needle"* ]]
}

get_field() {
  local file key
  file="$1"
  key="$2"
  awk -v k="$key" '
    BEGIN { in_yaml=0 }
    NR==1 && $0=="---" { in_yaml=1; next }
    in_yaml && $0=="---" { exit }
    in_yaml && $0 ~ "^" k ":" {
      sub("^" k ":[[:space:]]*", "", $0)
      print $0
      exit
    }
  ' "$file"
}

get_nested_field() {
  local file parent child
  file="$1"
  parent="$2"
  child="$3"
  awk -v p="$parent" -v c="$child" '
    BEGIN { in_yaml=0; in_parent=0 }
    NR==1 && $0=="---" { in_yaml=1; next }
    in_yaml && $0=="---" { exit }
    in_yaml && $0 ~ "^" p ":[[:space:]]*$" { in_parent=1; next }
    in_parent && $0 ~ "^[^[:space:]]" { in_parent=0 }
    in_parent && $0 ~ "^[[:space:]]+" c ":" {
      sub("^[[:space:]]+" c ":[[:space:]]*", "", $0)
      print $0
      exit
    }
  ' "$file"
}

has_list_items() {
  local file key
  file="$1"
  key="$2"
  awk -v k="$key" '
    BEGIN { in_yaml=0; in_list=0; found=0 }
    NR==1 && $0=="---" { in_yaml=1; next }
    in_yaml && $0=="---" { exit(found ? 0 : 1) }
    in_yaml && $0 ~ "^" k ":[[:space:]]*$" { in_list=1; next }
    in_list && $0 ~ "^[^[:space:]]" { in_list=0 }
    in_list && $0 ~ "^[[:space:]]*-[[:space:]]+" { found=1; exit(0) }
    END { if (found) exit(0); exit(1) }
  ' "$file"
}

QUERY_NORM="$(lower "$QUERY")"

{
while IFS= read -r -d '' file; do
  title="$(get_field "$file" title)"
  summary="$(get_field "$file" summary)"
  module="$(get_field "$file" module)"
  service="$(get_field "$file" service)"
  sig_error_code="$(get_nested_field "$file" problem_signature error_code)"
  sig_keyword="$(get_nested_field "$file" problem_signature keyword)"
  sig_log="$(get_nested_field "$file" problem_signature log)"
  sig_trigger="$(get_nested_field "$file" problem_signature trigger)"
  signature="${sig_error_code} ${sig_keyword} ${sig_log} ${sig_trigger}"
  status="$(get_field "$file" status)"
  date_field="$(get_field "$file" date)"

  score=0
  reasons=()

  if contains "$title" "$QUERY_NORM"; then
    score=$((score + 4))
    reasons+=("title")
  fi
  if contains "$summary" "$QUERY_NORM"; then
    score=$((score + 2))
    reasons+=("summary")
  fi
  if contains "$module" "$QUERY_NORM"; then
    score=$((score + 3))
    reasons+=("module")
  fi
  if contains "$service" "$QUERY_NORM"; then
    score=$((score + 2))
    reasons+=("service")
  fi
  if contains "$signature" "$QUERY_NORM"; then
    score=$((score + 4))
    reasons+=("problem_signature")
  fi

  if rg -qi -- "$QUERY" "$file"; then
    score=$((score + 1))
    reasons+=("body")
  fi

  if has_list_items "$file" verification_steps; then
    score=$((score + 1))
    reasons+=("verification_steps")
  fi

  if [[ "$status" == "deprecated" ]]; then
    score=$((score - 3))
    reasons+=("deprecated")
  fi

  if (( score > 0 )); then
    reason_csv="$(IFS=,; echo "${reasons[*]}")"
    printf '%s|%s|%s|%s|%s|%s|%s\n' \
      "$score" "${date_field:-0000-00-00}" "$file" "$title" "$module" "$service" "$reason_csv"
  fi
done < <(find "$TARGET_DIR" -type f -name '*.md' -print0)
} | sort -t '|' -k1,1nr -k2,2r \
| head -n "$LIMIT"
