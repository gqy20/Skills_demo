# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## System Architecture

This is a **personal AI assistant system** built on Claude Code Skills that generates customized skills based on user profiles and task descriptions.

```
User Input (info/) → User Profile (.info/usr.json) → Skill Generator → Custom Skills (.claude/skills/k01_task_name/)
```

### Key Components

1. **User Profile System** (`/user-profile`)
   - Analyzes files in `info/` directory (supports .md, .json, .pdf, .txt)
   - Generates structured profile at `.info/usr.json`
   - Profile dimensions: basic_info, tech_stack, preferences, behavioral_patterns, goals

2. **Skill Generator** (`/new-skill [task]`)
   - Reads user profile from `.info/usr.json`
   - Assigns task ID from `.info/tasks.json` (k01, k02, ...)
   - Extracts keywords from task description for naming
   - Generates customized skill at `.claude/skills/k01_task_name/SKILL.md`

3. **Task Tracking** (`.info/tasks.json`)
   - Maintains `next_id` counter
   - Records all generated tasks with metadata

## Skill Naming Convention

Generated skills use format: `k[编号]_[关键词]`

| Task Description | Generated Skill Directory |
|------------------|---------------------------|
| 搭建 Next.js 博客 | `k01_nextjs_blog` |
| 文章搜索功能 | `k02_article_search` |
| Git 工作流自动化 | `k03_git_automation` |

Rules:
- ID auto-increments from tasks.json
- Use lowercase English
- Connect with underscores

## Directory Structure

```
.claude/
├── settings.json           # Claude Code permissions and config
└── skills/
    ├── user-profile/       # User profile generation skill
    ├── skill-generator/    # Meta-skill that creates other skills
    └── k01_task_name/      # Generated skills

.info/
├── usr.json                # Generated user profile
├── usr.json.template       # Profile schema template
└── tasks.json              # Task index with next_id counter

info/                       # User input files (profile source)
```

## Common Commands

| Command | Purpose |
|---------|---------|
| `/user-profile` | Regenerate user profile from info/ files |
| `/new-skill [描述]` | Generate customized skill for task |
| `/k01_task_name` | Use generated skill |

## Customization Behavior

When generating skills, the system tailors output based on user profile:

- **tech_stack.primary_languages** → Uses familiar languages in examples
- **preferences.code_style** → Follows naming/formatting conventions
- **preferences.response_format** → Adapts communication style (code-first vs explanation-first)
- **behavioral_patterns.work_style** → Structures task steps (iterative vs planned)
- **goals.pain_points** → Avoids known problem areas

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
