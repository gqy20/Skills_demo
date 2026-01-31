# 技能升级交互流程

## 触发时机

当任务完成时（`/commander complete kXX`），触发技能升级询问。

## 交互流程

```
/commander complete k01
    ↓
更新 tasks.json.status = "completed"
更新 results/k01/README.md
    ↓
扫描任务中的 k_ 技能
    ↓
AskUserQuestion: 是否升级技能？
```

## 用户确认界面

### 第一步：显示执行结果

```
✅ 任务 k01 已完成！

任务: 调研 openclaw 并写公众号推文
状态: 已完成
时间: 2026-01-31
```

### 第二步：列出可升级技能

```
执行过程中使用了以下技能：

┌─────────────────────────────────────────────────────────┐
│ 技能名称              状态    可复用性                  │
├─────────────────────────────────────────────────────────┤
│ ✓ k01_research        成功    高 (可用于其他开源项目)   │
│ ✓ k01_write_article   成功    中 (可用于其他技术文章)   │
└─────────────────────────────────────────────────────────┘
```

### 第三步：询问升级

```
是否将成功的技能升级为可复用的验证技能？

升级后：
- 技能将保存为 p_ 前缀（验证技能）
- 可被后续任务自动复用
- 原 k_ 技能将被归档

请选择：
- 全部升级 → k01_research → p_research_open_source
              k01_write_article → p_article_techar
- 选择升级 → 让我选择具体升级哪些
- 跳过 → 不升级，保留 k_ 技能
```

### 第四步：命名确认（如选择"选择升级"）

```
选择要升级的技能：

[✓] k01_research
    建议名称: p_research_open_source
    描述: 调研开源项目的标准流程

[✓] k01_write_article
    建议名称: p_article_techar
    描述: 撰写技术文章的执行方案

确认升级？
- 确认 → 执行升级
- 修改名称 → 自定义技能名称
- 取消
```

### 第五步：执行升级

```
✅ 正在升级技能...

k01_research → p_research_open_source ✓
k01_write_article → p_article_techar ✓

✅ 升级完成！

已创建:
- .claude/skills/p_research_open_source/
- .claude/skills/p_article_techar/

已更新:
- .info/tasks.json (proven_skills)

已归档:
- .claude/skills/.archived/k01_research/
- .claude/skills/.archived/k01_write_article/
```

## 升级脚本调用

```bash
# 升级单个技能
.claude/hooks/promote-to-proven.sh k01_research p_research_open_source "调研开源项目的标准流程"

# 升级结果
- 创建 p_ 技能目录
- 复制并修改 SKILL.md
- 更新 tasks.json.proven_skills
- 归档原 k_ 技能
```

## 后续复用

当下一个任务需要类似能力时：

```
/commander start 调研另一个开源项目
    ↓
skill-generator 分析任务
    ↓
检测到 p_research_open_source 匹配
    ↓
复用而非创建新的 k_ 技能
    ↓
增加 p_research_open_source.usage_count
```

## 退出条件

以下情况不触发升级询问：

| 条件 | 原因 |
|-----|------|
| 任务失败 | 失败的技能不值得复用 |
| k_ 技能已在 p_ 中存在 | 可能是重复任务 |
| 用户选择"永不询问" | 用户偏好 |

## 配置选项

```json
// .info/tasks.json
{
  "settings": {
    "auto_promote": false,      // 是否自动升级（默认 false）
    "ask_on_complete": true,    // 完成时是否询问（默认 true）
    "archive_k_skills": true    // 升级后是否归档 k_（默认 true）
  }
}
```
