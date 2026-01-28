# Results

任务执行结果文件存储目录。

## 目录结构

```
results/
├── k01/                     # 任务 k01 的结果
│   ├── README.md            # 任务总览
│   ├── plan.md              # 任务计划
│   ├── execution.md         # 执行记录
│   ├── notes.md             # 备注笔记
│   └── artifacts/           # 生成的文件
│       ├── config/          # 配置文件
│       ├── code/            # 代码文件
│       └── diagrams/        # 图表
└── archived/                # 归档的任务
    └── k00_xxx/
```

## 文件说明

### README.md
任务总览，包含：
- 基本信息（编号、类型、状态）
- 进度条
- 步骤列表
- 下一步指引

### plan.md
任务计划，包含：
- 步骤列表
- 每步的预期产出
- 技术栈选型

### execution.md
执行记录，包含：
- 每步的开始/完成时间
- 执行内容
- 遇到的问题和解决方案
- 结果验证

### notes.md
备注笔记，包含：
- 中间想法
- 待办事项
- 参考链接

### artifacts/
执行过程中生成的文件：
- config/ - 配置文件
- code/ - 代码片段
- diagrams/ - 架构图、流程图

## 使用

```bash
# 查看任务结果
/commander results k01

# 直接打开文件
cat results/k01/README.md
cat results/k01/plan.md
```

## 归档

任务完成后，使用 `/commander archive k01` 归档到 `results/archived/`。
