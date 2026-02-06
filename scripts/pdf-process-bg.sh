#!/bin/bash
cd "$(dirname "$0")/.."
nohup python .claude/skills/pdf_processor/scripts/process.py > pdf_process.log 2>&1 &
echo "后台运行中 (PID: $!)"
echo "查看日志: tail -f pdf_process.log"
