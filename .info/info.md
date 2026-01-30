# 意图路由规则

> 本文件通过 UserPromptSubmit hook 自动注入到上下文。

## 意图映射表（按优先级）

| 优先级 | 意图 | 触发模式 | 处理方式 |
|:-----:|-----|---------|---------|
| 1 | command | `/*` | 直接执行命令 |
| 2 | identity | 我是谁, 我的画像, 我的信息 | `Skill("user-profile")` |
| 3 | task-doc | 帮我写*本子/申报书/报告 | `Skill("commander", "start --type=doc {描述}")` |
| 3 | task-dev | 帮我写, 创建, 开发, 实现, 搭建 | `Skill("commander", "start --type=dev {描述}")` |
| 3 | task-research | 研究, 分析, 调研 | `Skill("commander", "start --type=research {描述}")` |
| 4 | question | 如何, 怎么, 什么是, 为什么 | 直接回答 |
| 5 | other | 不匹配以上 | 智能分析 |

## 处理流程

```
用户输入 → 检查优先级 → 匹配意图 → 执行处理方式
```

## 快速参考

- **身份查询** → `Skill("user-profile")`
- **文档任务** → `Skill("commander", "start --type=doc")`
- **开发任务** → `Skill("commander", "start --type=dev")`
- **研究任务** → `Skill("commander", "start --type=research")`
- **问题咨询** → 直接回答

## 注意

1. 修改本文件后立即生效（下次输入时）
2. 详细处理逻辑在各 skill 中定义
3. 本文件会被频繁注入，请保持简洁
