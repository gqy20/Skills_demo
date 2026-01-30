# 意图路由规则

> **自动注入**：本文件在每次用户输入时通过 `UserPromptSubmit` hook 自动注入到上下文中。

## 触发机制

每次用户输入时，本文件会被注入到 Claude 的上下文中，作为意图识别和分发的参考规则。

---

## 意图类型映射表

| 意图类型 | 触发模式 | 处理方式 |
|---------|---------|---------|
| **identity** | "我是谁", "我的画像", "我的信息", "看看我的资料" | 调用 `Skill("user-profile")` |
| **task-doc** | "帮我写*本子", "帮我写*申报书", "帮我写*报告", "基金申请" | 调用 `Skill("commander", "start --type=doc {描述}")` |
| **task-dev** | "帮我写", "我要做", "创建一个", "开发", "实现", "搭建", "设计" | 调用 `Skill("commander", "start --type=dev {描述}")` |
| **task-research** | "研究", "分析", "调研" | 调用 `Skill("commander", "start --type=research {描述}")` |
| **question** | "如何", "怎么", "什么是", "为什么", "how", "what", "why" | 直接回答用户问题 |
| **command** | "/*" (以斜杠开头的命令) | 直接执行用户指定的命令 |
| **other** | 不匹配以上模式 | 智能分析并提供帮助 |

---

## 处理优先级

1. **检查命令模式** → 如果是 `/xxx` 格式，直接执行
2. **检查身份查询** → 如果匹配 identity 模式，调用 user-profile
3. **检查任务请求** → 如果匹配 task 模式，调用 commander
4. **检查问题咨询** → 如果匹配 question 模式，直接回答
5. **兜底处理** → 其他情况智能分析

---

## 详细处理说明

### identity（身份查询）

当用户询问身份信息时：
1. 调用 `Skill("user-profile")`
2. user-profile 会检查 `.info/usr.json` 是否存在和最新
3. 如果需要更新，询问用户
4. 如果最新，显示画像摘要

### task-doc（文档任务）

文档类任务（基金申请、报告等）：
1. 调用 `Skill("commander", "start --type=doc {任务描述}")`
2. commander 会分解任务并生成子技能

### task-dev（开发任务）

开发类任务（项目、应用、服务）：
1. 调用 `Skill("commander", "start --type=dev {任务描述}")`
2. commander 会分解任务并生成子技能

### question（问题咨询）

技术咨询类问题：
- 直接回答用户的问题
- 如果用户的问题隐含了完整任务需求，可以引导用户使用 commander

### command（直接命令）

用户使用命令格式（如 `/commander status`）：
- 直接执行对应的命令或 skill

---

## 注意事项

1. **本文件是动态配置**：修改后立即生效（下次用户输入时）
2. **本文件是规则定义**：详细的处理逻辑在各个 skill 中
3. **保持简洁**：本文件会被频繁注入到上下文，请保持内容简洁
4. **与 CLAUDE.md 分离**：本文件专注于行为规则，CLAUDE.md 是项目文档

---

## 相关文件

- `.claude/skills/user-profile/SKILL.md` - 身份查询处理
- `.claude/skills/commander/SKILL.md` - 任务管理
- `.claude/skills/skill-generator/SKILL.md` - 技能生成
- `.claude/hooks/intent-detect.sh` - 注入本文件的 hook
