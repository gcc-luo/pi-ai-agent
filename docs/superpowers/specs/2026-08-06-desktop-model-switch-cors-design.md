# 桌面端模型切换 CORS 修复设计

## 背景

Tauri 桌面版前端通过 WebView 从 `http://tauri.localhost` 直连随机端口上的
本地后端。切换模型时，前端发送带 JSON 请求体的 `PUT /api/config` 请求，
浏览器会先发送 CORS 预检。浏览器开发版使用 Vite 同源代理，因此不受影响。

## 根因

后端启用了 CORS，但没有显式声明桌面端写接口实际使用的 HTTP 方法。
WebView 阻止未通过预检的 `PUT` 请求，前端只能收到原生网络错误
`Failed to fetch`。HTTP 读取和 WebSocket 连接不受影响，所以界面仍显示
`CONNECTED`。

## 方案

在后端 CORS 配置中显式允许以下方法：

- `GET`
- `HEAD`
- `POST`
- `PUT`
- `PATCH`
- `DELETE`
- `OPTIONS`

保留现有动态 Origin 与凭据配置。这样既修复模型切换，也覆盖桌面端现有的
其他写接口，避免相同问题在更新、删除等操作中重复出现。

不修改前端模型切换流程，也不引入 Tauri HTTP 代理。

## 验证

增加后端集成测试，模拟 `http://tauri.localhost` 发起针对
`PUT /api/config`、携带 `content-type` 的预检请求，并验证：

- 响应状态为 `204`
- `access-control-allow-origin` 返回桌面 WebView Origin
- `access-control-allow-methods` 包含 `PUT`
- `access-control-allow-headers` 包含 `content-type`

随后运行该集成测试、后端完整测试及类型检查，确认没有回归。

## 范围

仅涉及后端 CORS 配置和对应集成测试。工作区中其他未提交改动不在本次修复
范围内，不做覆盖或整理。
