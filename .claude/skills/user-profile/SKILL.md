---
name: user-profile
description: 分析 info/ 目录下的用户文件，生成结构化用户画像。使用场景：(1) 首次使用时创建画像，(2) 修改 info/ 文件后刷新画像，(3) 指挥官检测到画像过期时自动触发。
---

# 用户画像生成

分析 `info/` 目录中的用户文件，生成结构化用户画像。

## 支持的文件格式

| 格式 | 用途 | 详情 |
|------|------|------|
| `.md` | 个人自述、文档 | 详见 [文件格式说明](references/) |
| `.json` | 结构化配置 | 详见 [文件格式说明](references/) |
| `.pdf` | 简历、文档 | 详见 [文件格式说明](references/) |
| `.txt` | 笔记、随笔 | 详见 [文件格式说明](references/) |

## 画像结构

用户画像包含以下维度，详见 [维度详细说明](references/dimensions.md)：

- **basic_info**: 姓名、角色、经验等级
- **tech_stack**: 语言、框架、工具
- **preferences**: 代码风格、沟通方式
- **behavioral_patterns**: 工作风格、协作偏好
- **goals**: 当前焦点、痛点、志向
- **metadata**: 版本、时间戳、源文件

## 处理流程

1. 扫描 `info/` 目录所有文件
2. 按类型提取信息，详见 [提取规则](references/extraction-rules.md)
3. 合并多源信息
4. 生成结构化 JSON
5. 保存到 `.info/usr.json`

## 输出示例

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
    "last_checked_at": "2026-01-27T16:00:00Z",
    "source_files": ["info/bio.md", ...],
    "source_mtimes": {},
    "confidence": "high"
  }
}
```

## 错误处理

| 场景 | 处理方式 |
|------|---------|
| `info/` 为空 | 提示用户添加文件 |
| 画像已存在 | 合并更新而非覆盖 |
| 冲突处理 | 优先使用最新修改的文件 |
