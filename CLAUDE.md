# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## System Architecture

This is a **personal AI assistant system** built on Claude Code Skills that generates customized sub-skills based on user profiles and task descriptions.

```
User Input (info/) → User Profile (.info/usr.json) → Skill Generator → Task Breakdown → Sub-skills (k01_xxx, k01_yyy, ...)
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
   - Profile dimensions: basic_info, tech_stack, preferences, behavioral_patterns, goals

2. **Skill Generator** (`/new-skill [task]`)
   - Reads user profile from `.info/usr.json`
   - Assigns task ID from `.info/tasks.json` (k01, k02, ...)
   - **Breaks down task into 2-10 steps**
   - **Generates a sub-skill for each step**
   - Shows plan to user for confirmation before generating

3. **Task Tracking** (`.info/tasks.json`)
   - Maintains `next_id` counter
   - Records all tasks with their sub-skills
   - Structure: `tasks.k01.steps = ["k01_init_project", "k01_config_mdx", ...]`

## Skill Naming Convention

| Level | Format | Example |
|-------|--------|---------|
| **Task** | `k[编号]` | k01 |
| **Sub-skill** | `k[任务]_[action]_[target]` | k01_init_project |

Sub-skill naming patterns:
- `k[task]_init_[project]` - Initialize (k01_init_project)
- `k[task]_config_[feature]` - Configure (k01_config_mdx)
- `k[task]_create_[component]` - Create (k01_create_layout)
- `k[task]_[feature]` - Implement feature (k01_article_list)
- `k[task]_fix_[issue]` - Fix issue (k01_fix_routing)
- `k[task]_test_[module]` - Test (k01_test_api)

## Directory Structure

```
.claude/
├── settings.json           # Claude Code permissions and config
└── skills/
    ├── user-profile/       # User profile generation skill
    ├── skill-generator/    # Meta-skill: task → sub-skills
    ├── k01_init_project/   # k01's sub-skill
    ├── k01_config_mdx/     # k01's sub-skill
    ├── k01_create_layout/  # k01's sub-skill
    └── k02_xxx/            # k02's sub-skill

.info/
├── usr.json                # Generated user profile
├── usr.json.template       # Profile schema template
└── tasks.json              # Task index with steps list

info/                       # User input files (profile source)
```

## Common Commands

| Command | Purpose |
|---------|---------|
| `/user-profile` | Regenerate user profile from info/ files |
| `/new-skill [描述]` | Create task and generate sub-skills |
| `/k01_init_project` | Use specific sub-skill |

## Skill Generation Flow

1. **Read user profile** - Extract preferences, tech stack, pain points
2. **Assign task ID** - Get next_id from tasks.json (e.g., k01)
3. **Break down task** - Decompose into 2-10 actionable steps
4. **Plan each sub-skill** - Design content for each step
5. **Show plan to user** - Display plan and wait for confirmation
6. **Generate sub-skills** - Create SKILL.md for each step
7. **Update documentation** - Update tasks.json, USAGE.md, CLAUDE.md

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
      "steps": [
        "k01_init_project",
        "k01_config_mdx",
        "k01_create_layout",
        "k01_article_list",
        "k01_article_detail"
      ],
      "created_at": "2026-01-27T16:00:00Z"
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
