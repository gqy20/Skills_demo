# 目录管理

## results/ 目录结构

```
results/
├── README.md          # 本目录说明
├── k01/              # 任务 k01 的工作目录
│   ├── README.md      # 任务总览
│   ├── plan.md        # 任务计划
│   ├── execution.md   # 执行记录
│   ├── notes.md       # 笔记
│   └── artifacts/     # 生成的文件
│       ├── layout.tsx
│       └── config.json
├── k02/              # 任务 k02 的工作目录
└── archived/         # 已归档的任务
    ├── k01/
    └── k02/
```

## 文件说明

### README.md

任务总览文件，包含：

| 字段 | 说明 |
|-----|------|
| 任务 ID | k01 |
| 任务名称 | 用户输入的描述 |
| 任务类型 | web/cli/api/tool/config |
| 创建时间 | ISO 8601 格式 |
| 状态 | active/completed/archived |
| 步骤列表 | 所有子技能名称 |
| 完成时间 | 任务完成时添加 |

### plan.md

任务计划文件，包含：

- 任务目标
- 执行步骤列表
- 每个步骤的预期输出
- 依赖关系说明

### execution.md

执行记录文件，按时间顺序记录：

```markdown
## 2026-01-27 16:00:00

### k01_init_project

执行内容：
- 创建 package.json
- 安装依赖

结果：
- ✓ 成功创建项目

---

## 2026-01-27 16:15:00

### k01_config_mdx

执行内容：
- 配置 @next/mdx
- 添加 MDX 组件

结果：
- ✓ MDX 配置完成
```

### notes.md

笔记文件，记录执行过程中的发现和思考：

```markdown
## 2026-01-27 16:10:00

发现 Next.js 14 的新 App Router 更适合本项目。

## 2026-01-27 16:20:00

MDX 的 frontmatter 需要额外配置 gray-matter。
```

### artifacts/

存放任务执行过程中生成的所有文件。

| 文件类型 | 存放位置 |
|---------|---------|
| 代码文件 | artifacts/src/ |
| 配置文件 | artifacts/ |
| 文档文件 | artifacts/docs/ |
| 资源文件 | assets/ |

## 目录创建时机

| 时机 | 操作 |
|-----|------|
| 任务启动 | 创建 results/k01/ 及基础文件 |
| 步骤执行 | 更新 execution.md，生成 artifacts |
| 笔记添加 | 追加到 notes.md |
| 任务归档 | 移动到 results/archived/ |

## 目录清理策略

| 场景 | 处理 |
|-----|------|
| 任务取消 | 删除 results/k01/ |
| 任务完成 | 保留，可选归档 |
| 归档满 30 天 | 提示清理 |

## git 管理

`.gitignore` 配置：

```
# 保留所有文件，但忽略敏感输入
results/*/
!results/*/README.md
!results/*/artifacts/

# 忽略敏感文件
results/*/user-inputs/
results/*/secrets/
```
