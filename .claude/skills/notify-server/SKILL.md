---
name: notify-server
description: 启动 Claude Code 浏览器通知服务器
---

启动 Claude Code 浏览器通知服务器。

## 使用方法

运行此 skill 后：

1. **本地环境**：直接访问 http://localhost:8888/notify

2. **Codespace 环境**：
   - 点击底部 "Ports" 标签
   - 找到端口 8888，点击 "Forward"
   - 打开浏览器访问转发后的地址
   - 点击 "启用浏览器通知" 按钮

## 工作原理

服务器会监控 `.info/.last_complete` 文件，每当 `Stop` hook 触发时更新时间戳，网页每秒轮询检查并显示通知。

## 停止服务器

按 `Ctrl+C` 停止服务器。

---

请执行：运行后台任务 `bash .claude/hooks/start-notify-server.sh`
