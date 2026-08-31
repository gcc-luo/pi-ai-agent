# 桌面任务完成通知名称与图标设计

## 目标

当 Agent 会话在用户当前未查看的情况下完成时，Windows 桌面通知应归属于
PI AI Agent，而不是开发环境承载进程 `Windows PowerShell`，并使用应用已有的
PI 图标。通知点击后的窗口恢复和会话消息跳转行为保持不变。

## 根因

`apps/web/src/stores/desktop.ts` 当前在 Tauri 环境中优先创建浏览器
`window.Notification`。Windows 会根据 Web Notification 的承载进程标识展示
通知来源，因此开发环境中显示为 `Windows PowerShell`，也不会使用 Tauri 应用
配置的名称和图标。代码中已有的 Tauri 原生 `sendNotification` 分支由于该优先
级不会正常执行。

## 方案

桌面端通知统一通过 `@tauri-apps/plugin-notification` 的原生
`sendNotification` 发送：

1. 保留现有权限检查和未读状态逻辑。
2. 将会话标题作为通知标题、完成摘要作为通知正文。
3. 将 `notificationId`、`projectId`、`sessionId` 和可选的 `messageId`
   继续放入 `extra`，由初始化时注册的 `onAction` 监听器处理点击。
4. 依赖 Tauri 配置中的 `productName: "PI-AI-Agent"` 与现有应用图标资源，
   不修改安装包名称、应用标识或图标文件。
5. 移除桌面通知路径对 `window.Notification` 的优先使用，避免通知被归属到
   PowerShell；通知失败时继续依赖持久化未读数和角标作为兜底。

## 数据流与边界

会话完成事件 → `useNotificationStore.handleSettled` 判断当前窗口是否正在查看
目标会话 → 非查看状态下刷新未读数并调用
`useDesktopStore.showTaskNotification` → Tauri 原生通知 → 用户点击 →
`onAction` 读取 `extra` → 恢复窗口 → 跳转到对应项目、会话和消息。

本次不改变“正在查看目标会话时不弹通知”的判定，也不改变通知正文、未读数、
角标或导航目标的数据结构。

## 错误处理

- 原生通知权限未授予时，保持现有请求权限流程；仍无权限则不发送通知。
- 原生通知发送或点击监听失败时，捕获异常，不影响会话完成状态和持久化未读
  数据。
- `extra` 缺少合法导航字段时，忽略点击导航，保持现有安全校验。

## 测试策略

- 更新桌面 Store 单元测试：验证任务完成通知调用原生 `sendNotification`，
  传递正确的标题、正文、自动取消选项和导航 `extra`；验证不创建 Web
  Notification。
- 保留并运行通知 Store 与任务通知策略测试，确保“后台会话弹通知、前台目标
  会话不弹通知”的行为不回归。
- 运行 Web 测试、桌面脚本测试和 Web 类型检查。

## 不在本次范围内

- 不调整主窗口标题。
- 不修改 Windows 安装包文件名或 `productName` 的既有大小写。
- 不新增通知设置页、声音配置或跨平台通知样式定制。
