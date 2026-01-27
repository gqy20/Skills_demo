# Skills Demo

基于 Claude Code Skills 的个人 AI 辅助开发系统。

## 核心思路

```
用户画像 → 任务拆解 → 子技能生成 → 逐步执行 → 结果记录
```

### 工作流程

1. **建立画像** - 在 `info/` 目录添加个人信息，运行 `/user-profile`
2. **启动任务** - 使用 `/k start [任务描述]` 创建新任务
3. **执行步骤** - 逐个使用生成的子技能完成每一步
4. **查看结果** - 在 `results/k01/` 查看执行过程和产出文件

### 快速开始

```bash
# 1. 准备用户信息（在 info/ 目录下添加文件）
# 2. 生成用户画像
/user-profile

# 3. 启动任务
/k start 搭建 Next.js 博客

# 4. 执行第一步
/k01_init_project

# 5. 查看进度
/k status
/k progress k01
```

## 目录结构

```
.claude/skills/    # 技能目录
    ├── user-profile/    # 画像生成
    ├── commander/       # 指挥官（主入口）
    ├── skill-generator/ # 技能生成器
    └── k01_init_project/ # 生成的子技能

.info/             # 数据目录
    ├── usr.json        # 用户画像
    └── tasks.json      # 任务索引

info/              # 用户输入（个人信息）

results/           # 任务结果（执行过程文件）
    └── k01/           # 任务 k01 的结果
```

## 核心命令

| 命令 | 说明 |
|------|------|
| `/user-profile` | 生成用户画像 |
| `/k start [任务]` | 启动新任务 |
| `/k status` | 全局状态 |
| `/k progress k01` | 任务进度 |
| `/k01_init_project` | 执行子技能 |

## 设计理念

- **以人为本** - 基于用户画像定制 AI 行为
- **任务驱动** - 将大任务拆解为可执行的子技能
- **过程可见** - 所有执行记录保存在 results/ 目录

详细使用说明请查看 [USAGE.md](USAGE.md)。
