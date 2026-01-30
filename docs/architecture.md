# Skills Architecture

本文档说明 Skills 系统的核心架构设计，明确各组件的职责边界和数据流向。

## 设计原则：清晰边界

系统采用**职责分离**的设计原则，每个 skill 有明确的单一职责：

| Skill | 角色 | 核心职责 |
|-------|------|---------|
| **user-profile** | 数据生产者 | 从原始数据生成用户画像 |
| **commander** | 任务调度器 | 管理任务的完整生命周期 |
| **skill-generator** | 技能分析师 | 分析任务并生成技能文件 |

## 系统架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                        用户输入层                                 │
├─────────────────────────────────────────────────────────────────┤
│  info/ 目录                                                      │
│  ├─ bio.md          (个人自述)                                    │
│  ├─ skills.md       (技术栈)                                      │
│  ├─ preferences.json (偏好设置)                                   │
│  └─ goals.md        (目标与痛点)                                  │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                      数据生产层                                   │
├─────────────────────────────────────────────────────────────────┤
│  user-profile (纯数据生产者)                                      │
│  ├─ 输入: info/ 目录的原始文件                                     │
│  ├─ 处理: 分析文件内容，提取用户信息                               │
│  └─ 输出: .info/usr.json                                         │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                      调度协调层                                   │
├─────────────────────────────────────────────────────────────────┤
│  commander (任务调度器)                                          │
│  ├─ 检查用户画像新鲜度                                            │
│  ├─ 接收任务描述                                                  │
│  ├─ 调用 skill-generator                                         │
│  ├─ 接收技能列表                                                  │
│  └─ 协调技能执行                                                  │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                      分析生成层                                   │
├─────────────────────────────────────────────────────────────────┤
│  skill-generator (技能分析师)                                    │
│  ├─ 输入: 任务描述 + .info/usr.json                              │
│  ├─ 分析: 识别所需能力，匹配已有技能                              │
│  ├─ 生成: 创建 k_ 技能文件                                        │
│  └─ 输出: 技能列表给 commander                                   │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                      执行层                                       │
├─────────────────────────────────────────────────────────────────┤
│  k01_init_project  (任务子技能)                                   │
│  k01_config_mdx                                                  │
│  k01_create_layout                                               │
│  k01_article_list                                                │
│  k01_article_detail                                              │
└─────────────────────────────────────────────────────────────────┘
```

## 数据流向

### 1. 用户画像生成流程

```
info/ 文件 → user-profile → .info/usr.json
```

- **触发方式**：
  - 用户手动调用 `/user-profile`
  - 用户问"我是谁"时智能触发
  - commander 检测到画像过期时提示用户

- **数据内容**：
  ```json
  {
    "basic_info": {},
    "tech_stack": {},
    "preferences": {},
    "behavioral_patterns": {},
    "goals": {},
    "experience": [],
    "metadata": {
      "version": "1.0.0",
      "generated_at": "2026-01-30T12:00:00Z",
      "source_files": ["info/bio.md", ...]
    }
  }
  ```

### 2. 任务创建流程

```
用户输入任务 → commander → skill-generator → k_ 技能文件
                   ↓
            检查画像新鲜度
                   ↓
              提示更新（如需要）
```

**步骤说明**：

1. **commander** 接收任务描述
2. **commander** 检查 `.info/usr.json` 新鲜度
   - 对比 `metadata.source_mtimes` 与 info/ 文件
   - 如过期，提示用户运行 `/user-profile`
3. **commander** 调用 **skill-generator**，传入：
   - 任务描述
   - `.info/usr.json` 内容
4. **skill-generator** 分析并返回：
   ```json
   {
     "task_id": "k01",
     "task_name": "搭建 Next.js 博客",
     "skills": [
       {"id": "k01_init_project", "type": "new"},
       {"id": "k01_config_mdx", "type": "new"},
       {"id": "u_next_mdx", "type": "reuse"}
     ]
   }
   ```
5. **commander** 创建 `results/k01/` 目录
6. **commander** 更新 `.info/tasks.json` 的 `tasks.k01` 字段

### 3. 技能执行流程

```
commander → k01_init_project → 完成 → commander → k01_config_mdx → ...
```

**步骤说明**：

1. **commander** 读取 `tasks.k01.skills` 列表
2. **commander** 按顺序调用每个技能
3. **commander** 更新 `tasks.k01.current_step`
4. **commander** 在 `results/k01/execution.md` 记录执行日志

## 职责边界矩阵

| 操作 | user-profile | commander | skill-generator |
|-----|-------------|-----------|-----------------|
| 读取 info/ 文件 | ✅ | ❌ | ❌ |
| 生成 .info/usr.json | ✅ | ❌ | ❌ |
| 检查画像新鲜度 | ❌ | ✅ | ❌ |
| 管理任务状态 | ❌ | ✅ | ❌ |
| 分析任务内容 | ❌ | ❌ | ✅ |
| 生成 k_ 技能文件 | ❌ | ❌ | ✅ |
| 协调技能执行 | ❌ | ✅ | ❌ |
| 创建 results/ 目录 | ❌ | ✅ | ❌ |
| 更新 tasks.json | ❌ | ✅ | ❌ |
| 读取 tasks.json | ❌ | ✅ | ❌ |
| 读取 usr.json | ❌ | ✅ | ✅ |
| 修改 usr.json | ✅ | ❌ | ❌ |

## 关键设计决策

### 1. 为什么 user-profile 不管理任务状态？

**原因**：数据生产者应该保持纯粹，不关心数据如何被使用。

**好处**：
- 可独立测试和维护
- 可被其他系统复用（不依赖 commander）
- 职责单一，降低复杂度

### 2. 为什么 commander 不生成技能文件？

**原因**：任务调度器应该专注于流程控制，而非内容分析。

**好处**：
- commander 保持轻量，易于扩展
- skill-generator 可独立演进（支持更复杂的分析算法）
- 技能生成逻辑可被其他场景复用

### 3. 为什么 skill-generator 不管理 tasks.json？

**原因**：分析师应该只负责分析，不应管理状态。

**好处**：
- 职责清晰，避免状态同步问题
- commander 对任务状态有完全控制权
- 降低耦合度，便于测试

## 接口规范

### user-profile 接口

**输入**：
- `info/` 目录路径（默认：`/workspaces/Skills_demo/info/`）

**输出**：
- `.info/usr.json`（用户画像）

**触发**：
- 手动调用：`/user-profile`
- 智能触发：用户问"我是谁"
- 外部提示：commander 检测到过期

### commander 接口

**命令**：
- `/commander start [描述]` - 启动新任务
- `/commander status` - 显示全局状态
- `/commander progress k01` - 显示任务进度
- `/commander continue k01` - 继续执行
- `/commander complete k01` - 标记完成
- `/commander archive k01` - 归档任务

**依赖**：
- 读取 `.info/usr.json`（检查新鲜度）
- 读取 `.info/tasks.json`（管理任务）
- 调用 `skill-generator`（生成技能）

**输出**：
- 更新 `.info/tasks.json`
- 创建 `results/k01/` 目录

### skill-generator 接口

**输入**：
- 任务描述（string）
- 用户画像（`.info/usr.json` 内容）

**输出**：
- 技能文件（`.claude/skills/k01_*/SKILL.md`）
- 技能列表（array）

**调用**：
- 由 commander 调用
- 用户手动调用（分析特定任务）

## 文件所有权

| 文件/目录 | 所有者 | 说明 |
|----------|--------|------|
| `info/` | 用户 | 输入数据，由 user-profile 读取 |
| `.info/usr.json` | user-profile | 由 user-profile 生成和维护 |
| `.info/tasks.json` | commander | 由 commander 维护任务状态 |
| `.claude/skills/k[0-9]_*/` | skill-generator | 由 skill-generator 创建 |
| `results/k[0-9]*/` | commander | 由 commander 创建和管理 |
| `.claude/skills/user-profile/` | 系统 | 核心 skill，不生成 |
| `.claude/skills/commander/` | 系统 | 核心 skill，不生成 |
| `.claude/skills/skill-generator/` | 系统 | 核心 skill，不生成 |
| `.claude/skills/u_*/` | user-profile | 由 user-profile 从经验中提取 |

## 扩展性设计

### 添加新的核心 Skill

如果需要添加新的核心 skill（如 `dependency-manager`）：

1. 明确其职责边界
2. 定义与其他 skills 的接口
3. 更新本架构文档
4. 更新相关 SKILL.md 的"与其他 Skills 的关系"章节

### 添加新的数据源

如果需要支持新的用户数据源（如环境变量、外部 API）：

1. 仅修改 `user-profile`
2. 不影响 commander 和 skill-generator
3. 更新 `.info/usr.json` 的 metadata 记录来源

### 添加新的任务类型

如果需要支持新的任务类型（如持续任务、周期任务）：

1. commander 负责扩展任务状态机
2. skill-generator 负责识别新类型并生成对应技能
3. 不影响 user-profile

## 常见问题

### Q: 为什么不让 skill-generator 直接更新 tasks.json？

**A**: 这会破坏职责边界。skill-generator 是分析师，应该只返回分析结果。由 commander 决定如何使用这些结果，可以保持更好的控制力和灵活性。

### Q: user-profile 能否主动通知 commander 画像已更新？

**A**: 不建议。这会增加耦合。当前的"commander 检查新鲜度"模式更符合单向数据流原则，降低了系统复杂度。

### Q: 能否跳过 skill-generator 直接生成技能？

**A**: 不建议。skill-generator 提供了基于用户画像的智能分析，直接生成会失去定制化能力，且容易生成不合适的技能。

### Q: k_ 技能能否调用 user-profile？

**A**: 不应该。k_ 技能是执行层，应该专注于完成任务。如果需要用户信息，应该读取 `.info/usr.json`，而不是触发重新生成。

## 版本历史

- **v1.0.0** (2026-01-30): 初始架构设计，明确三个核心 skills 的职责边界
