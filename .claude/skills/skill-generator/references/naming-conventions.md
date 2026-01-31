# 子技能命名规范

> **重要**：技能名称可自定义，以下为推荐的命名模式。唯一要求是前缀正确标识技能类型。

## 命名模式

| 步骤类型 | 命名模式 | 示例 |
|---------|---------|------|
| 初始化 | `k[任务]_init_[项目]` | k01_init_project |
| 配置 | `k[任务]_config_[功能]` | k01_config_mdx |
| 创建 | `k[任务]_create_[组件]` | k01_create_layout |
| 实现 | `k[任务]_[功能]` | k01_article_list |
| 修复 | `k[任务]_fix_[问题]` | k01_fix_routing |
| 测试 | `k[任务]_test_[模块]` | k01_test_api |
| 添加 | `k[任务]_add_[功能]` | k01_add_search |
| 删除 | `k[任务]_remove_[功能]` | k01_remove_deps |
| 更新 | `k[任务]_update_[内容]` | k01_update_deps |
| 重构 | `k[任务]_refactor_[模块]` | k01_refactor_auth |

## 命名原则

1. **使用英文小写**
2. **用下划线连接**
3. **简洁明了**
4. **见名知意**

## 常见组合

### Web 开发
```
k01_init_project      # 初始化项目
k01_config_styling      # 配置样式
k01_create_layout     # 创建布局
k01_implement_auth     # 实现认证
k01_add_search        # 添加搜索
```

### API 开发
```
k02_design_schema     # 设计数据库
k02_implement_auth     # 实现认证
k02_create_endpoints   # 创建接口
k02_add_middleware    # 添加中间件
k02_write_docs        # 编写文档
```

### CLI 工具
```
k03_parse_args         # 解析参数
k03_validate_input     # 验证输入
k03_core_function      # 核心功能
k03_handle_errors     # 错误处理
k03_write_readme       # 编写帮助
```
