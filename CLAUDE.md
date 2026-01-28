# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## System Architecture

This is a **personal AI assistant system** built on Claude Code Skills that generates customized sub-skills based on user profiles and task descriptions.

```
User Input (info/) → User Profile (.info/usr.json) → Commander → Task Breakdown → Sub-skills (k01_xxx, ...)
```

**Core Concept**: One Task = Multiple Sub-skills

```
Task k01 (搭建 Next.js 博客)
    ├─ k01_init_project     # Sub-skill: Initialize project
    ├─ k01_config_mdx        # Sub-skill: Configure MDX
    ├─ k01_create_layout     # Sub-skill: Create layout
    ├─ k01_article_list      # Sub-skill: Article list page
    └─ k01_article_detail    # Sub-skill: Article detail page
```

### Key Components

1. **User Profile System** (`/user-profile`)
   - Analyzes files in `info/` directory (supports .md, .json, .pdf, .txt)
   - Generates structured profile at `.info/usr.json`
   - Profile dimensions: basic_info, tech_stack, preferences, behavioral_patterns, goals, user_skills

2. **Commander** (`/commander`)
   - Main entry point for task management
   - Commands: start, status, progress, list, results, continue, complete, archive
   - Auto-checks user profile freshness before starting tasks

3. **Skill Generator** (`/skill-generator`)
   - Reads user profile from `.info/usr.json`
   - Assigns task ID from `.info/tasks.json` (k01, k02, ...)
   - Breaks down task into 2-10 steps
   - Generates a sub-skill for each step
   - Shows plan to user for confirmation before generating

4. **Hooks System** (`.claude/hooks/`)
   - `session-start.sh` - Auto-checks user profile freshness on session start
   - `update-status.sh` - Updates `.info/.status.json` after tool use (for statusline)
   - `track-skills-change.sh` - Auto-registers skills to tasks.json on create/edit

5. **Statusline** (`.claude/statusline.sh`)
   - Custom status bar showing: GLM quota, context usage, session time, token stats, task progress, user info, skills count
   - Reads from `.info/.status.json` updated by hooks

## Directory Structure

```
.claude/
├── settings.json           # Claude Code config (permissions, statusLine, hooks)
├── statusline.sh           # Custom status bar script
├── hooks/
│   ├── session-start.sh    # Check profile freshness on session start
│   ├── update-status.sh    # Update .info/.status.json for statusline
│   └── track-skills-change.sh  # Auto-register skills to tasks.json
└── skills/
    ├── user-profile/       # User profile generation skill
    ├── commander/          # Task management main entry
    ├── skill-generator/    # Meta-skill: task → sub-skills
    └── k[0-9]*_*/          # Generated sub-skills (e.g., k01_init_project/)

.info/
├── usr.json                # Generated user profile
├── usr.json.template       # Profile schema template
├── tasks.json              # Task index with steps list + user_skills
├── .status.json            # Runtime status for statusline
└── skills_changelog.jsonl  # Skills change log

info/                       # User input files (profile source)
├── bio.md                  # Personal bio
├── skills.md               # Tech stack
├── preferences.json        # Preferences config
└── goals.md                # Goals and pain points

docs/                       # Documentation
├── usage.md                # Detailed usage guide
├── results.md              # results/ directory structure
└── statusline.md           # Statusline configuration

results/                    # Task execution results (created at runtime)
└── k01/                    # Task k01 results
```

## Skill Naming Convention

| Level | Format | Pattern | Example |
|-------|--------|---------|---------|
| **Task** | `k[编号]` | Task ID | k01 |
| **Sub-skill** | `k[任务]_[action]_[target]` | Task sub-skills | k01_init_project |
| **User-skill** | `u_[name]` | User-learned skills | u_react_hooks |

Sub-skill naming patterns:
- `k[task]_init_[project]` - Initialize
- `k[task]_config_[feature]` - Configure
- `k[task]_create_[component]` - Create
- `k[task]_[feature]` - Implement feature
- `k[task]_fix_[issue]` - Fix issue
- `k[task]_test_[module]` - Test

## Common Commands

| Command | Purpose |
|---------|---------|
| `/user-profile` | Regenerate user profile from info/ files |
| `/commander start [任务]` | Create new task and generate sub-skills |
| `/commander status` | Show global system status |
| `/commander progress k01` | Show task detailed progress |
| `/commander continue k01` | Execute next step |
| `/k01_init_project` | Execute specific sub-skill |

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_AUTH_TOKEN` | API authentication token (for GLM quota in statusline) |
| `ANTHROPIC_BASE_URL` | API base URL (e.g., `https://open.bigmodel.cn/api/anthropic`) |

## Skill Generation Flow

1. **Read user profile** - Extract preferences, tech stack, pain points from `.info/usr.json`
2. **Assign task ID** - Get next_id from tasks.json (e.g., k01)
3. **Break down task** - Decompose into 2-10 actionable steps
4. **Plan each sub-skill** - Design content for each step based on user profile
5. **Show plan to user** - Display plan and wait for confirmation
6. **Generate sub-skills** - Create SKILL.md for each step in `.claude/skills/k[0-9]_*/`
7. **Update tasks.json** - Add task with steps list (auto-handled by PostToolUse hook)

## Customization Behavior

When generating sub-skills, the system tailors output based on user profile:

- **tech_stack.primary_languages** → Uses familiar languages in examples
- **preferences.code_style** → Follows naming/formatting conventions
- **preferences.response_format** → Adapts communication style (code-first vs explanation-first)
- **behavioral_patterns.work_style** → Structures task steps (iterative vs planned)
- **goals.pain_points** → Avoids known problem areas

## tasks.json Structure

```json
{
  "next_id": 2,
  "tasks": {
    "k01": {
      "id": "k01",
      "name": "搭建 Next.js 博客",
      "type": "web",
      "status": "active",
      "steps": ["k01_init_project", "k01_config_mdx", ...],
      "created_at": "2026-01-27T16:00:00Z"
    }
  },
  "user_skills": {
    "u_react_hooks": {
      "name": "u_react_hooks",
      "level": "proficient",
      "created_at": "2026-01-27T16:00:00Z",
      "usage_count": 0
    }
  }
}
```

## Commit Convention

Use conventional commits format:

```
feat: add new feature
fix: fix bug
docs: update documentation
refactor: refactor code
chore: maintenance tasks
```

Include `Co-Authored-By: Claude (glm-4.7) <noreply@anthropic.com>` for Claude-assisted commits.
