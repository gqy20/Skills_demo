---
name: user-profile
description: Analyze user files in info/ directory and generate structured user profile. Use this when: (1) Initial setup to create user profile, (2) User modified info/ files and needs to refresh profile, (3) Commander detects outdated profile.
---

# User Profile Generator

Generate a structured user profile from files in the `info/` directory.

## When to Use

- **Initial setup**: First time running the system
- **Profile update**: After modifying files in `info/`
- **Commander trigger**: Automatically triggered when profile is outdated

## Supported File Formats

| Format | Usage |
|--------|--------|
| `.md` | Personal bio, documentation |
| `.json` | Structured configuration |
| `.pdf` | Resume, documentation (use Read tool) |
| `.txt` | Notes, thoughts |

## Profile Structure

The generated `.info/usr.json` contains:

- **basic_info**: Name, role, experience level
- **tech_stack**: Languages, frameworks, tools
- **preferences**: Code style, communication style
- **behavioral_patterns**: Work style, collaboration
- **goals**: Current focus, pain points, aspirations
- **metadata**: Version, timestamps, source files

## Process

1. Scan all files in `info/`
2. Extract and merge information from multiple sources
3. Generate structured JSON profile
4. Save to `.info/usr.json`

## Output Format

```json
{
  "basic_info": {},
  "tech_stack": {},
  "preferences": {},
  "behavioral_patterns": {},
  "goals": {},
  "metadata": {
    "version": "1.0.0",
    "generated_at": "2026-01-27T16:00:00Z",
    "source_files": ["info/bio.md", "info/skills.md", ...]
  }
}
```

## Error Handling

- If `info/` is empty: Prompt user to add files
- If profile exists: Merge updates rather than overwrite
- Conflict resolution: Prefer latest modified file
