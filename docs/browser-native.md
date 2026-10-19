# Browser Use 原生扩展集成

Browser Use 直接加载 `pi-agent-browser-native` 的发布版入口。宿主通过包装
`registerTool().execute` 接入授权、状态回传和文件展示，不重写页面快照、定位或命令解析。

## 固定依赖

- Pi：`@earendil-works/pi-coding-agent@0.84.0`，保留 Windows Shell 回退补丁。
- 扩展：`pi-agent-browser-native@0.6.10`。
- 执行器：`agent-browser@0.37.0`。
- Node.js：24 或以上。开发与桌面构建使用同一套依赖。

这是一组固定的兼容基线，不自动追随最新版。扩展新版本的工具契约可能变化，升级应重跑真实浏览器测试。
开发环境默认启动本地 Pi CLI；显式 `PI_COMMAND` / `PI_ARGS` 仍可覆盖，但需自行保证兼容。

## 安装与运行

执行 `pnpm install`，然后重启服务端和现有 Agent 会话。
上游默认检测系统 Chrome。没有可用浏览器时运行：

```sh
pnpm --filter @pi-web-ui/server browser:install
```

Web 版本以无界面模式运行，并通过应用内浏览器面板显示浏览器流。
Tauri 桌面版默认在右侧面板创建原生 WebView；Agent 浏览器操作通过本机桥接直接
作用于当前活动面板页面，不启动第二个浏览器，也不以图像帧作为页面显示内容。
桌面端的原生视图使用系统 WebView（Windows WebView2、macOS WKWebView、Linux WebKitGTK），
同一面板中的网页交互和 Agent DOM 操作作用于同一页面。调试时设置
`PI_BROWSER_HEADED=true` 可显式显示独立浏览器窗口；`PI_BROWSER_HEADLESS=true`
始终优先并强制无界面模式。
桌面安装包携带扩展和平台原生执行器，通过私有运行目录中的可执行文件接入 PATH，
不要求用户全局安装 npm CLI。Chrome 的安装和更新仍由系统或上游安装命令负责。

桌面版每个浏览器面板标签创建一个原生系统 WebView。活动标签通过本机 WebSocket
接收 Agent 操作请求，并将 DOM 快照、定位、导航、点击和输入操作执行在该 WebView
的页面中；标签失活时桥接断开，避免 Agent 请求误发到后台标签。浏览器标签之间
独立保留页面状态，Agent 跟随当前活动的浏览器标签。Web 版本继续使用浏览器图像流，
因为它无法访问 Tauri 桌面端的原生子 WebView。

原生共享模式目前支持常用 `args` 页面操作、`semanticAction` 的点击/填表/勾选，
以及基础 `qa` 页面检查。上游扩展中依赖 CDP 或文件系统的功能（例如完整 `script` /
`job` 工作流、截图、下载和网络事件检查）尚未接入原生 WebView；调用时会返回明确的
不支持错误，不会静默启动另一个浏览器。Tauri 多 WebView API 使用 unstable Cargo
feature，后续 Tauri 升级需要复核该 API 的兼容性。

## 会话与操作确认

宿主为每个对话分配确定性的 session，为每个会话存储根目录分配 namespace。
自动配置保存在会话根目录的 `.browser/` 下。不会继承环境中的 `AGENT_BROWSER_*`
配置或用户默认共享会话，以免不同对话操作同一个浏览器。

默认浏览器在插件禁用、对话关闭、应用退出或会话挂起时回收，异常退出由 15 分钟
空闲超时兜底。用户显式指定的其他 session/profile/CDP 连接遵循上游所有权规则，
宿主不会全局关闭这些浏览器。profile 登录持久化需显式配置，不把默认会话当作永久登录环境。

常规打开页面、快照、截图、读取和滚动可直接执行。点击、填表、上传、eval、
脚本、批量调用及会话配置变更接入现有权限弹窗。脚本确认覆盖整次调用，弹窗展示参数；
宿主不逐行解释脚本。无法交互确认的渠道拒绝这类调用。审计记录调用 ID、风险和结果，
不复制表单密码、脚本全文或页面正文。

**网络策略发生变化**：旧 Playwright 层的私网地址拦截和
`PI_BROWSER_ALLOW_PRIVATE_NETWORK` 已移除。现在采用 agent-browser 原生网络行为，
可以访问本机和内网；此扩展不构成网络隔离沙箱。需要网络隔离的部署应配置运行环境
或上游网络策略，不能依赖已移除的开关。

## 工具与产物

对话中注册 `agent_browser`，不再注册旧的 16 个 `browser_*` 工具。
可选 `agent_browser_web_search` 仅在扩展检测到可用搜索配置时注册。
原有插件开关和 `/sessions/:id/browser` 状态接口保留；旧内部执行 API 返回 410。

建议截图、下载和 PDF 保存到项目的 `browser/` 下。宿主从扩展返回的 artifacts / manifest
提取已存在的工作区文件，转换为聊天产物；工作区外路径、逃逸符号链接、临时 spill
和登录 state/auth 文件不会成为附件。扩展的图片内容保持原样，供模型使用。
文件在浏览器关闭后保留，可在聊天中预览或下载。

## 验证

```sh
pnpm --filter @pi-web-ui/server typecheck
pnpm --filter @pi-web-ui/server test
PI_BROWSER_SMOKE=1 pnpm --filter @pi-web-ui/server exec vitest run tests/integration/browser-session-manager.test.ts
```

真实浏览器测试需要本机 Chrome 或已安装的 Chromium：通过真实 Pi 扩展加载器测试
页面打开、快照、填写、点击、图片产物、授权拒绝和宿主清理，不调用模型 API。
桌面打包脚本也验证打包后的 Pi 与 agent-browser 可执行文件版本。
