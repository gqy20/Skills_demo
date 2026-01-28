# Claude Code 数据分析文档

## 概述

本文档详细分析 Claude Code 在 `~/.claude` 目录中产生的各类数据结构和内容，提供数据统计方法、分析命令和具体样本。

---

## 目录结构总览

```
~/.claude/
├── cache/              # 缓存目录 (84K)
├── debug/              # 调试日志 (12M)
├── downloads/          # 下载文件 (4K)
├── file-history/       # 文件历史记录 (636K)
├── history.jsonl       # 命令历史记录 (32K, 116条)
├── ide/                # IDE 相关数据 (8K)
├── plans/              # 计划数据 (4K)
├── plugins/            # 插件数据 (5.6M)
├── projects/           # 项目数据 (8.1M)
├── session-env/        # 会话环境 (48K, 13个会话)
├── shell-snapshots/    # Shell 快照 (196K, 5个)
├── stats-cache.json    # 统计缓存 (4K)
├── statsig/            # 统计签名数据 (44K)
├── tasks/              # 任务数据 (20K)
├── telemetry/          # 遥测数据 (4K)
├── todos/              # 待办事项 (52K)
└── glm_quota_cache.txt # GLM 配额缓存 (4K)
```

**总计**: 约 33MB 数据

---

## 详细数据解析

### 1. history.jsonl - 命令历史记录

#### 文件信息
- **路径**: `~/.claude/history.jsonl`
- **大小**: 32KB
- **记录数**: 116 条
- **会话数**: 12 个独立会话

#### 数据结构
```json
{
  "display": "用户输入的命令/问题描述",
  "pastedContents": {},           // 粘贴的内容（通常为空）
  "timestamp": 1769591864247,      // Unix时间戳(毫秒)
  "project": "/home/codespace/.claude",  // 项目路径
  "sessionId": "67c9d00a-e822-46ad-b0b5-f6cbc35f224b"  // 会话ID(UUID)
}
```

#### 统计命令示例
```bash
# 基础统计
wc -l ~/.claude/history.jsonl

# 按会话统计
cat ~/.claude/history.jsonl | python3 << 'EOF'
import json, sys
from collections import Counter
from datetime import datetime

sessions = {}
for line in sys.stdin:
    item = json.loads(line)
    sid = item['sessionId']
    if sid not in sessions:
        sessions[sid] = {'count': 0, 'projects': set(), 'start': None, 'end': None}
    sessions[sid]['count'] += 1
    sessions[sid]['projects'].add(item['project'])
    ts = item['timestamp']
    if not sessions[sid]['start'] or ts < sessions[sid]['start']:
        sessions[sid]['start'] = ts
    if not sessions[sid]['end'] or ts > sessions[sid]['end']:
        sessions[sid]['end'] = ts

print(f"{'会话ID':<12} {'消息数':<8} {'持续时间':<12} {'项目'}")
print("-" * 80)
for sid, info in sorted(sessions.items(), key=lambda x: -x[1]['count']):
    duration = (info['end'] - info['start']) / 1000
    projects = ', '.join([p.split('/')[-1] for p in info['projects']])
    print(f"{sid[:10]}... {info['count']:<8} {duration:<12.0f} {projects}")
EOF

# 按项目统计
cat ~/.claude/history.jsonl | jq -r '.project' | sort | uniq -c | sort -rn
```

#### 当前统计结果
```
会话ID              消息数    持续时间      项目
--------------------------------------------------------------------------------
75467b45-e8... 31        3612         Skills_demo
3969d0c2-bd... 22        56691        Skills_demo
39ab776a-77... 19        2138         Skills_demo
c1722feb-f2... 16        3914         Skills_demo
717add44-34... 11        2383         Skills_demo
2a05b4ae-e9... 7         868          Skills_demo
67c9d00a-e8... 4         484          .claude
9bb57ae6-48... 2         126          dotfiles
```

#### 用途
- 命令历史恢复
- 用户行为分析
- 会话时间线重建
- 项目使用频率统计

---

### 2. projects/ - 项目数据

#### 目录结构
```
~/.claude/projects/
├── -home-codespace--claude/                    # 主目录项目
│   └── 67c9d00a-e822-46ad-b0b5-f6cbc35f224b.jsonl (159KB)
├── -workspaces-Skills-demo/                    # Skills_demo 项目
│   ├── 1bf057ba-8a2f-4f82-84ca-8cd97f182646.jsonl    (23KB, 25行)
│   ├── 2a05b4ae-e94a-4ce8-9b96-4b1959217e47.jsonl    (290KB, 124行)
│   ├── 3969d0c2-bd58-4a03-8a6f-95fa1d9a3d23/        # 子代理目录
│   │   └── subagents/
│   │       ├── agent-a134822.jsonl             (61KB)
│   │       ├── agent-a6df6f9.jsonl             (57KB)
│   │       └── agent-ab325a4.jsonl             (62KB)
│   ├── 3969d0c2-bd58-4a03-8a6f-95fa1d9a3d23.jsonl    (1.5MB, 746行)
│   ├── 39ab776a-7715-44e3-87f1-fb1078997159.jsonl    (932KB, 592行)
│   ├── 717add44-3450-47b7-a494-ffa4a08286f2.jsonl    (261KB, 217行)
│   ├── 75467b45-e985-4f51-81e7-8b01b92dc6ec.jsonl    (1.7MB, 731行)
│   ├── c1722feb-f2b3-4ca5-a1c1-6c3f738613a3/        # 子代理目录
│   │   └── subagents/
│   │       └── agent-a349ca8.jsonl             (144KB)
│   ├── c1722feb-f2b3-4ca5-a1c1-6c3f738613a3.jsonl    (3.3MB, 1200行)
│   ├── e660599f-317c-43af-8a08-88580e28cfc0.jsonl    (4KB, 12行)
│   ├── e92f3fc5-4571-4fcc-8012-43c2ea4dee9b.jsonl    (1KB, 5行)
│   ├── 7e2ebee3-79dc-42b8-bc89-5245ab2e389d.jsonl    (2KB, 8行)
│   ├── 3a6d568f-c6a8-417b-aa4a-7eb8d2117394.jsonl    (3KB, 4行)
│   ├── 61dc7501-071b-48ae-984d-f3008763f83a.jsonl    (2KB, 3行)
│   └── sessions-index.json                     (4KB, 会话索引)
└── -workspaces-Skills-demo-dotfiles/           # dotfiles 项目
    └── 9bb57ae6-4808-4ece-9934-de2d64b644d9.jsonl (11KB)
```

#### sessions-index.json 结构
```json
{
  "version": 1,
  "entries": [
    {
      "sessionId": "e92f3fc5-4571-4fcc-8012-43c2ea4dee9b",
      "fullPath": "/home/codespace/.claude/projects/.../sessionId.jsonl",
      "fileMtime": 1769524957650,
      "firstPrompt": "No prompt",
      "summary": "MCP Server Configuration Check",
      "messageCount": 2,
      "created": "2026-01-27T14:40:44.542Z",
      "modified": "2026-01-27T14:40:44.537Z",
      "gitBranch": "main",
      "projectPath": "/workspaces/Skills_demo",
      "isSidechain": false
    }
  ],
  "originalPath": "/workspaces/Skills_demo"
}
```

#### 会话文件记录数统计
```
文件名                                                      行数     大小
c1722feb-f2b3-4ca5-a1c1-6c3f738613a3.jsonl                 1200    3.3MB  (最活跃)
3969d0c2-bd58-4a03-8a6f-95fa1d9a3d23.jsonl                  746    1.5MB
75467b45-e985-4f51-81e7-8b01b92dc6ec.jsonl                  731    1.7MB
39ab776a-7715-44e3-87f1-fb1078997159.jsonl                  592    932KB
717add44-3450-47b7-a494-ffa4a08286f2.jsonl                  217    261KB
2a05b4ae-e94a-4ce8-9b96-4b1959217e47.jsonl                  124    290KB
```

#### 统计命令
```bash
# 统计各项目会话数量
find ~/.claude/projects/ -name "sessions-index.json" -exec cat {} \; | \
  jq -r '.originalPath' | sort | uniq -c

# 统计总行数
find ~/.claude/projects/ -name "*.jsonl" -exec wc -l {} + | tail -1

# 查找最大会话文件
find ~/.claude/projects/ -name "*.jsonl" -exec wc -c {} + | sort -rn | head -5
```

#### 会话文件内容样本
每个 `.jsonl` 文件包含完整的对话记录，格式如下（简化示例）:
```json
{
  "type": "user_message",
  "timestamp": "2026-01-27T14:34:02.441Z",
  "content": {
    "role": "user",
    "content": "用户的问题或命令"
  }
}
```

---

### 3. debug/ - 调试日志

#### 目录信息
- **路径**: `~/.claude/debug/`
- **大小**: 12MB (最大目录)
- **文件数**: 13 个日志文件
- **命名格式**: `{sessionId}.txt`

#### 日志级别和类型
```
[DEBUG]   - 调试信息（最常见）
[INFO]    - 一般信息
[WARN]    - 警告信息
[ERROR]   - 错误信息
```

#### 日志内容示例
```
2026-01-27T14:32:57.226Z [DEBUG] Failed to check enabledPlatforms
2026-01-27T14:32:57.271Z [DEBUG] Applying permission update: Adding 7 allow rule(s)
2026-01-27T14:32:57.287Z [ERROR] Error: ENOENT: no such file or directory
2026-01-27T14:32:57.289Z [DEBUG] getPluginSkills: Processing 0 enabled plugins
2026-01-27T14:32:57.302Z [DEBUG] [STARTUP] Commands and agents loaded in 6ms
```

#### 错误统计（Top 20）
```bash
# 统计错误类型
grep -h "ERROR\|WARN" ~/.claude/debug/*.txt | \
  sed 's/.*\[ERROR\] Error: //' | \
  sort | uniq -c | sort -rn | head -20
```

**常见错误模式**:
1. **API 并发限制** (7次): `您当前使用该API的并发数过高`
2. **Bash 预检超时** (14次): `Pre-flight check is taking longer than expected`
3. **文件系统错误**: `EISDIR: illegal operation on a directory`
4. **JSON 解析错误**: `JSON Parse error: Unrecognized token`
5. **流中断**: `AbortError: The operation was aborted`
6. **流延迟警告**: `Streaming stall detected`

#### 统计命令
```bash
# 按会话统计日志行数
for f in ~/.claude/debug/*.txt; do
  echo "$(wc -l < "$f") $(basename "$f")"
done | sort -rn

# 错误统计
grep -c "\[ERROR\]" ~/.claude/debug/*.txt

# 时间范围统计
head -1 ~/.claude/debug/*.txt | tail -1
tail -1 ~/.claude/debug/*.txt | tail -1

# 按组件统计
grep -o "\[.*\]" ~/.claude/debug/*.txt | sort | uniq -c | sort -rn | head -20
```

#### 日志分析用途
- 性能问题诊断
- API 调用失败分析
- 权限问题排查
- MCP 服务器连接问题
- 文件操作错误追踪

---

### 4. stats-cache.json - 使用统计缓存

#### 完整结构
```json
{
  "version": 1,
  "lastComputedDate": "2026-01-27",
  "dailyActivity": [
    {
      "date": "2026-01-27",
      "messageCount": 997,
      "sessionCount": 5,
      "toolCallCount": 252
    }
  ],
  "dailyModelTokens": [
    {
      "date": "2026-01-27",
      "tokensByModel": {
        "glm-4.7": 1834
      }
    }
  ],
  "modelUsage": {
    "glm-4.7": {
      "inputTokens": 1051,
      "outputTokens": 783,
      "cacheReadInputTokens": 169984,
      "cacheCreationInputTokens": 0,
      "webSearchRequests": 0,
      "costUSD": 0,
      "contextWindow": 0,
      "maxOutputTokens": 0
    }
  },
  "totalSessions": 5,
  "totalMessages": 997,
  "longestSession": {
    "sessionId": "75467b45-e985-4f51-81e7-8b01b92dc6ec",
    "duration": 3782909,
    "messageCount": 663,
    "timestamp": "2026-01-27T14:34:02.441Z"
  },
  "firstSessionDate": "2026-01-27T14:29:58.244Z",
  "hourCounts": {
    "14": 4,
    "15": 1
  }
}
```

#### 字段说明
| 字段 | 类型 | 说明 |
|------|------|------|
| `dailyActivity` | Array | 每日活动统计 |
| `messageCount` | Number | 当日消息总数 |
| `sessionCount` | Number | 当日会话数 |
| `toolCallCount` | Number | 当日工具调用次数 |
| `inputTokens` | Number | 输入 Token 数 |
| `outputTokens` | Number | 输出 Token 数 |
| `cacheReadInputTokens` | Number | 缓存读取 Token 数 |
| `cacheCreationInputTokens` | Number | 缓存创建 Token 数 |
| `webSearchRequests` | Number | 网络搜索请求数 |
| `costUSD` | Number | 成本（美元） |
| `longestSession` | Object | 最长会话信息 |
| `hourCounts` | Object | 每小时使用分布 |

#### 统计命令
```bash
# 查看总统计
cat ~/.claude/stats-cache.json | jq '{
  总会话数: .totalSessions,
  总消息数: .totalMessages,
  最长会话: .longestSession.messageCount,
  活跃时段: .hourCounts
}'

# 查看模型使用
cat ~/.claude/stats-cache.json | jq '.modelUsage | to[] | {
  模型: keys[0],
  输入Token: .[].inputTokens,
  输出Token: .[].outputTokens,
  缓存命中: .[].cacheReadInputTokens
}'
```

---

### 5. session-env/ - 会话环境

#### 目录信息
- **路径**: `~/.claude/session-env/`
- **大小**: 48KB
- **会话数**: 13 个

#### 会话列表
```
2a05b4ae-e94a-4ce8-9b96-4b1959217e47
3969d0c2-bd58-4a03-8a6f-95fa1d9a3d23
39ab776a-7715-44e3-87f1-fb1078997159
67c9d00a-e822-46ad-b0b5-f6cbc35f224b
717add44-3450-47b7-a494-ffa4a08286f2
75467b45-e985-4f51-81e7-8b01b92dc6ec
7e2ebee3-79dc-42b8-bc89-5245ab2e389d
9bb57ae6-4808-4ece-9934-de2d64b644d9
c1722feb-f2b3-4ca5-a1c1-6c3f738613a3
e660599f-317c-43af-8a08-88580e28cfc0
e92f3fc5-4571-4fcc-8012-43c2ea4dee9b
1bf057ba-8a2f-4f82-84ca-8cd97f182646
3a6d568f-c6a8-417b-aa4a-7eb8d2117394
```

#### 用途
存储每个会话的环境变量、配置状态和上下文信息，用于会话恢复。

---

### 6. todos/ - 待办事项

#### 目录信息
- **路径**: `~/.claude/todos/`
- **大小**: 52KB
- **文件数**: 12 个
- **命名格式**: `{sessionId}-agent-{agentId}.json`

#### 文件列表
```
1bf057ba-...-agent-1bf057ba-....json
2a05b4ae-...-agent-2a05b4ae-....json
3969d0c2-...-agent-3969d0c2-....json
...
```

#### 数据结构
每个文件包含任务队列数据：
```json
{
  "tasks": [
    {
      "id": "task-id",
      "status": "pending|in_progress|completed",
      "subject": "任务标题",
      "description": "任务描述",
      "activeForm": "进行中的形式",
      "created": "2026-01-27T...",
      "modified": "2026-01-27T..."
    }
  ]
}
```

---

### 7. tasks/ - 任务数据

#### 目录信息
- **路径**: `~/.claude/tasks/`
- **大小**: 20KB
- **子目录**: 2 个

#### 目录结构
```
~/.claude/tasks/
├── 3969d0c2-bd58-4a03-8a6f-95fa1d9a3d23/
└── c1722feb-f2b3-4ca5-a1c1-6c3f738613a3/
```

#### 用途
- 存储任务状态快照
- 任务依赖关系
- 子任务执行记录

---

### 8. file-history/ - 文件历史

#### 目录信息
- **路径**: `~/.claude/file-history/`
- **大小**: 636KB
- **存储方式**: 按会话ID组织

#### 目录结构
```
~/.claude/file-history/
├── 1bf057ba-8a2f-4f82-84ca-8cd97f182646/
├── 2a05b4ae-e94a-4ce8-9b96-4b1959217e47/
├── 3969d0c2-bd58-4a03-8a6f-95fa1d9a3d23/
├── 39ab776a-7715-44e3-87f1-fb1078997159/
├── 67c9d00a-e822-46ad-b0b5-f6cbc35f224b/
├── 717add44-3450-47b7-a494-ffa4a08286f2/
├── 75467b45-e985-4f51-81e7-8b01b92dc6ec/
├── 7e2ebee3-79dc-42b8-bc89-5245ab2e389d/
├── 9bb57ae6-4808-4ece-9934-de2d64b644d9/
├── c1722feb-f2b3-4ca5-a1c1-6c3f738613a3/
├── e660599f-317c-43af-8a08-88580e28cfc0/
└── e92f3fc5-4571-4fcc-8012-43c2ea4dee9b/
```

#### 用途
- 记录文件修改历史
- 版本控制和回滚
- 文件变更追踪

---

### 9. shell-snapshots/ - Shell 快照

#### 目录信息
- **路径**: `~/.claude/shell-snapshots/`
- **大小**: 196KB
- **文件数**: 5 个

#### 文件列表
```
snapshot-bash-1769588231859-n3r9h8.sh
snapshot-bash-1769589153409-52zkap.sh
snapshot-bash-1769589851326-xja6t0.sh
snapshot-bash-1769591825111-jezrm3.sh
```

#### 命名格式
`snapshot-{shell_type}-{timestamp}-{random}.sh`

#### 用途
- 保存 shell 命令执行环境
- 环境变量快照
- 调试 shell 相关问题

---

### 10. cache/ - 缓存目录

#### 目录信息
- **路径**: `~/.claude/cache/`
- **大小**: 84KB

#### 主要文件
```
changelog.md    (79KB) - Claude Code 版本更新日志
```

#### 用途
- 存储 Claude Code 版本信息
- 减少重复网络请求
- 临时缓存数据

---

### 11. plugins/ - 插件数据

#### 目录信息
- **路径**: `~/.claude/plugins/`
- **大小**: 5.6MB

#### 目录结构
```
~/.claude/plugins/
├── known_marketplaces.json                      (279B)
└── marketplaces/
    └── claude-plugins-official/
        └── plugins/
            ├── commit-commands/
            ├── frontend-design/
            ├── learning-output-style/
            ├── php-lsp/
            └── ...
```

#### 已安装插件
- commit-commands: 提交命令相关
- frontend-design: 前端设计辅助
- learning-output-style: 学习输出风格
- php-lsp: PHP 语言服务器协议

#### 用途
- 存储已安装的插件
- 插件配置文件
- 插件技能定义

---

### 12. 其他重要文件/目录

#### ide/ - IDE 数据
```
~/.claude/ide/
└── 45192.lock    (182B) - IDE 锁文件
```

#### plans/ - 计划数据
```
~/.claude/plans/
(当前为空，用于 Plan Mode)
```

#### telemetry/ - 遥测数据
```
~/.claude/telemetry/
(用于产品改进的匿名数据)
```

#### statsig/ - 统计签名
```
~/.claude/statsig/
(用于 A/B 测试和功能分析)
```

#### glm_quota_cache.txt - GLM 配额缓存
```
~/.claude/glm_quota_cache.txt    (34B)
```

---

## 数据统计脚本

### 综合统计脚本
```bash
#!/bin/bash
# ~/.claude 统计脚本

echo "=== Claude Code 数据统计 ==="
echo

echo "1. 目录大小统计:"
du -sh ~/.claude/* 2>/dev/null | sort -h | awk '{printf "%-20s %s\n", $2, $1}'
echo

echo "2. 历史记录统计:"
echo "   总记录数: $(wc -l < ~/.claude/history.jsonl)"
echo "   会话数: $(cat ~/.claude/history.jsonl | jq -r '.sessionId' | sort -u | wc -l)"
echo

echo "3. 项目会话统计:"
find ~/.claude/projects/ -name "sessions-index.json" -exec cat {} \; | \
  jq -r '.originalPath + ": " + string(.entries | length) + " 个会话"'
echo

echo "4. 调试日志统计:"
echo "   日志文件数: $(ls ~/.claude/debug/*.txt 2>/dev/null | wc -l)"
echo "   总错误数: $(grep -c "\[ERROR\]" ~/.claude/debug/*.txt 2>/dev/null | awk '{s+=$1} END {print s}')"
echo

echo "5. 存储空间分布:"
echo "   debug/: $(du -sh ~/.claude/debug 2>/dev/null | cut -f1)"
echo "   projects/: $(du -sh ~/.claude/projects 2>/dev/null | cut -f1)"
echo "   plugins/: $(du -sh ~/.claude/plugins 2>/dev/null | cut -f1)"
```

### Token 使用统计
```bash
cat ~/.claude/stats-cache.json | python3 << 'EOF'
import json, sys
data = json.load(sys.stdin)

print("=== Token 使用统计 ===")
for model, usage in data['modelUsage'].items():
    print(f"\n模型: {model}")
    print(f"  输入 Token: {usage['inputTokens']:,}")
    print(f"  输出 Token: {usage['outputTokens']:,}")
    print(f"  缓存命中: {usage['cacheReadInputTokens']:,}")
    print(f"  缓存创建: {usage['cacheCreationInputTokens']:,}")
    print(f"  总计: {usage['inputTokens'] + usage['outputTokens']:,}")
    print(f"  成本: ${usage['costUSD']:.4f}")

print("\n=== 每日活动 ===")
for day in data['dailyActivity']:
    print(f"{day['date']}:")
    print(f"  消息数: {day['messageCount']}")
    print(f"  会话数: {day['sessionCount']}")
    print(f"  工具调用: {day['toolCallCount']}")
EOF
```

### 会话活跃度分析
```bash
cat ~/.claude/history.jsonl | python3 << 'EOF'
import json, sys
from datetime import datetime

sessions = {}
for line in sys.stdin:
    item = json.loads(line)
    sid = item['sessionId']
    if sid not in sessions:
        sessions[sid] = {'count': 0, 'project': item['project']}
    sessions[sid]['count'] += 1

print("=== 会话活跃度 Top 10 ===")
for sid, info in sorted(sessions.items(), key=lambda x: -x[1]['count'])[:10]:
    print(f"{info['count']:3d} 条 - {info['project'].split('/')[-1]} ({sid[:8]}...)")
EOF
```

---

## 数据清理指南

### 可安全清理的目录
```bash
# 清理调试日志 (可节省 ~12MB)
rm ~/.claude/debug/*.txt

# 清理 shell 快照 (可节省 ~196KB)
rm ~/.claude/shell-snapshots/*.sh

# 清理旧缓存
rm ~/.claude/cache/changelog.md
```

### 建议保留的数据
- `history.jsonl` - 核心历史记录
- `projects/` - 项目配置和会话
- `session-env/` - 会话环境
- `tasks/`, `todos/` - 任务数据
- `file-history/` - 文件历史

### 清理脚本
```bash
#!/bin/bash
# Claude Code 数据清理脚本

echo "清理前:"
du -sh ~/.claude

# 清理 7 天前的调试日志
find ~/.claude/debug/ -name "*.txt" -mtime +7 -delete

# 清理 30 天前的 shell 快照
find ~/.claude/shell-snapshots/ -name "*.sh" -mtime +30 -delete

echo
echo "清理后:"
du -sh ~/.claude
```

---

## 数据分析场景

### 1. 使用习惯分析
```bash
# 最常使用的命令
cat ~/.claude/history.jsonl | jq -r '.display' | sort | uniq -c | sort -rn | head -20

# 最活跃的时段
cat ~/.claude/history.jsonl | jq -r '.timestamp | tonumber / 1000 | strftime("%Y-%m-%d %H:00")' | sort | uniq -c
```

### 2. 项目使用频率
```bash
cat ~/.claude/history.jsonl | jq -r '.project' | sort | uniq -c | sort -rn
```

### 3. 会话持续时间分析
```bash
cat ~/.claude/history.jsonl | python3 << 'EOF'
import json, sys
from datetime import datetime

sessions = {}
for line in sys.stdin:
    item = json.loads(line)
    sid = item['sessionId']
    ts = item['timestamp'] / 1000
    if sid not in sessions:
        sessions[sid] = {'start': ts, 'end': ts}
    sessions[sid]['end'] = max(sessions[sid]['end'], ts)

print("=== 会话时长分布 ===")
durations = [(s['end'] - s['start']) / 60 for s in sessions.values()]
print(f"最短: {min(durations):.1f} 分钟")
print(f"最长: {max(durations):.1f} 分钟")
print(f"平均: {sum(durations)/len(durations):.1f} 分钟")
print(f"总计: {sum(durations):.1f} 分钟")
EOF
```

### 4. 错误频率分析
```bash
# 按错误类型统计
grep "\[ERROR\]" ~/.claude/debug/*.txt | \
  sed 's/.*\[ERROR\] Error: //' | \
  sort | uniq -c | sort -rn | head -10

# 按会话统计错误
for f in ~/.claude/debug/*.txt; do
  echo "$(grep -c "\[ERROR\]" "$f") $(basename "$f")"
done | sort -rn | head -5
```

---

## 数据备份和迁移

### 备份脚本
```bash
#!/bin/bash
# Claude Code 数据备份

BACKUP_DIR="$HOME/claude-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

echo "备份到: $BACKUP_DIR"

# 备份核心数据
cp ~/.claude/history.jsonl "$BACKUP_DIR/"
cp ~/.claude/stats-cache.json "$BACKUP_DIR/"
cp -r ~/.claude/projects "$BACKUP_DIR/"
cp -r ~/.claude/session-env "$BACKUP_DIR/"

# 创建压缩包
tar -czf "${BACKUP_DIR}.tar.gz" -C "$HOME" ".claude"
echo "备份完成: ${BACKUP_DIR}.tar.gz"
```

### 跨设备迁移
```bash
# 导出数据
tar -czf claude-data-export.tar.gz -C "$HOME" ".claude"

# 导入数据（在新设备上）
tar -xzf claude-data-export.tar.gz -C "$HOME"
```

---

## 安全和隐私注意事项

### 敏感数据位置
1. **history.jsonl** - 包含所有用户输入
2. **debug/*** - 可能包含文件路径和错误堆栈
3. **projects/**/*.jsonl** - 完整对话记录
4. **file-history/** - 文件内容副本

### 保护建议
```bash
# 设置适当的文件权限
chmod 700 ~/.claude
chmod 600 ~/.claude/history.jsonl
chmod 600 ~/.claude/stats-cache.json

# 确保不提交到 git
echo ".claude/" >> .gitignore
echo "*.jsonl" >> .gitignore
```

### 清理敏感数据
```bash
# 清除包含特定关键词的历史
cat ~/.claude/history.jsonl | \
  jq 'select(.display | contains("password") | not)' > \
  ~/.claude/history.jsonl.tmp && \
  mv ~/.claude/history.jsonl.tmp ~/.claude/history.jsonl
```

---

## 数据 API 和工具

### 使用 jq 查询数据
```bash
# 获取最近的 10 条命令
cat ~/.claude/history.jsonl | jq -r '.display' | tail -10

# 按项目分组统计
cat ~/.claude/history.jsonl | jq -r '.project' | sort | uniq -c

# 获取特定会话的所有记录
cat ~/.claude/history.jsonl | \
  jq 'select(.sessionId == "75467b45-e985-4f51-81e7-8b01b92dc6ec")'

# 时间范围查询
cat ~/.claude/history.jsonl | \
  jq 'select(.timestamp > 1769500000000 and .timestamp < 1769600000000)'
```

### Python 分析示例
```python
#!/usr/bin/env python3
import json
from pathlib import Path
from datetime import datetime
from collections import Counter

# 加载历史数据
history_file = Path.home() / '.claude' / 'history.jsonl'
data = [json.loads(line) for line in history_file.read_text().splitlines()]

# 分析
print(f"总记录数: {len(data)}")
print(f"会话数: {len(set(d['sessionId'] for d in data))}")
print(f"项目数: {len(set(d['project'] for d in data))}")

# 时间分布
hours = Counter(datetime.fromtimestamp(d['timestamp']/1000).hour for d in data)
print("\n每小时活跃度:")
for hour in sorted(hours):
    bar = '█' * (hours[hour] // 2)
    print(f"{hour:02d}:00 {bar} {hours[hour]}")
```

---

## 总结

### 数据分布
| 目录 | 大小 | 占比 | 用途 |
|------|------|------|------|
| debug/ | 12MB | 36% | 调试日志 |
| projects/ | 8.1MB | 24% | 项目数据 |
| plugins/ | 5.6MB | 17% | 插件数据 |
| file-history/ | 636KB | 2% | 文件历史 |
| shell-snapshots/ | 196KB | <1% | Shell快照 |
| 其他 | ~6MB | 21% | 其他数据 |

### 关键发现
1. **最活跃会话**: c1722feb (1200条消息)
2. **总消息数**: 997 条
3. **主要项目**: Skills_demo (11个会话)
4. **常见问题**: API 并发限制 (7次)

### 优化建议
1. 定期清理 `debug/` 目录
2. 压缩归档旧会话文件
3. 设置日志轮转策略
4. 监控 Token 使用量
