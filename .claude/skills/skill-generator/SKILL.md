---
name: skill-generator
description: Break down tasks into steps and generate sub-skills based on user profile. Use this when: (1) Commander creates a new task, (2) User requests task breakdown, (3) A complex task needs to be decomposed into executable sub-skills.
---

# Skill Generator

Break down tasks into executable sub-skills, customized based on user profile.

## When to Use

- **Task creation**: When `/k start` creates a new task
- **Task breakdown**: Decompose complex tasks into 2-10 steps
- **Sub-skill generation**: Create individual skills for each step

## Process

1. Read user profile from `.info/usr.json`
2. Assign task ID (k01, k02, ...)
3. Analyze task type (web/cli/api/tool/config)
4. Break down into steps (2-10 steps)
5. Generate sub-skill for each step
6. Create `results/k01/` with plan files
7. Update `.info/tasks.json`

## Sub-skill Naming

| Type | Pattern | Example |
|------|---------|---------|
| Initialize | `k[task]_init_[project]` | k01_init_project |
| Configure | `k[task]_config_[feature]` | k01_config_mdx |
| Create | `k[task]_create_[component]` | k01_create_layout |
| Implement | `k[task]_[feature]` | k01_article_list |
| Fix | `k[task]_fix_[issue]` | k01_fix_routing |
| Test | `k[task]_test_[module]` | k01_test_api |

## Output Files

For each task `k01`:

```
.claude/skills/
├── k01_init_project/SKILL.md
├── k01_config_mdx/SKILL.md
└── ...

results/k01/
├── README.md       # Task overview
├── plan.md         # Task plan
├── execution.md    # Execution log
├── notes.md        # Notes
└── artifacts/      # Generated files
```

## Customization

Generated sub-skills are tailored based on user profile:

- **tech_stack.primary_languages** → Use familiar languages
- **preferences.code_style** → Follow naming/formatting conventions
- **preferences.response_format** → Adapt communication style
- **goals.pain_points** → Avoid known problem areas

## tasks.json Structure

```json
{
  "next_id": 2,
  "tasks": {
    "k01": {
      "id": "k01",
      "name": "任务名称",
      "type": "web",
      "status": "active",
      "steps": ["k01_init_project", "k01_config_mdx", ...],
      "current_step": 0,
      "created_at": "2026-01-27T16:00:00Z"
    }
  }
}
```

## Error Handling

- If user profile doesn't exist: Prompt to run `/user-profile`
- If steps < 2: Task too simple, consider direct execution
- If steps > 10: Task too complex, suggest splitting
- If user cancels: Restore tasks.json next_id
