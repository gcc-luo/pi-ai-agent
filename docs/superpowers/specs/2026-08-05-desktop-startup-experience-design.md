# 桌面端启动体验设计

## 目标

Windows 桌面端首次启动时不弹出任何命令窗口，并在后端运行时解压和健康检查期间立即显示主窗口内的加载界面。

## 根因

Windows 首次启动会调用 `tar.exe` 解压内置服务运行时。该 `std::process::Command` 没有设置 `CREATE_NO_WINDOW`，因此会创建黑色控制台窗口。前端入口在后端健康检查成功前没有挂载 Vue，也没有预置 HTML，因此窗口内容为空白。

## 方案

`index.html` 在 `#app` 内提供纯 HTML/CSS 启动屏，WebView 创建后即可渲染；`main.ts` 保留异步后端初始化，在成功后由 Vue 主应用替换启动屏，在失败后替换为错误页。启动屏使用应用已有的深色基调、品牌徽标、简短文案和低成本 CSS 动效，不加载外部资源。

Windows 专用的 `extract_archive` 为 `tar.exe` 设置 `CREATE_NO_WINDOW`。现有 Tauri shell sidecar 已在依赖实现中设置此标志，因此不再额外改动 Node sidecar 启动方式。

## 验收标准

- 启动 HTML 在 JavaScript 和后端就绪前已包含可见加载内容。
- 后端可用时，启动 HTML 被 Vue 主应用替换。
- 后端失败时，启动 HTML 被错误状态替换。
- Windows `tar.exe` 使用 `CREATE_NO_WINDOW` 创建，首次解压不会弹出控制台窗口。
