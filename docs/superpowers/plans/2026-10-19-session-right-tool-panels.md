# 会话右侧工具面板实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐任务实现本计划。步骤使用复选框跟踪进度。

**目标：** 在聊天右侧加入会话级文件浏览器、浏览器和交互式终端标签，并保留当前文件与知识库引用预览。

**架构：** Vue 侧增加会话隔离的工具面板状态与标签 Shell；文件浏览器复用当前文件 API 和预览组件。浏览器面板通过 Fastify WebSocket 代理订阅本会话 `agent-browser` 的画面流与输入，PTY 由 Fastify 服务端管理并通过独立 WebSocket 提供给 xterm.js。

**技术栈：** Vue 3、Pinia、Fastify WebSocket、`agent-browser` stream、`node-pty`、`@xterm/xterm`、`@xterm/addon-fit`、pnpm monorepo。

**参考源码：** `D:\ai-agent\cindy\apps\desktop\src\renderer\features\right-sidebar\RightSidebarShell.tsx` 展示多个标签内容常驻挂载、仅切换可见性的做法；同目录 `store.ts` 按 `sessionId` 管理标签桶，`registry.ts` 负责工具类型注册；`plugins\file-browser`、`plugins\web-browser`、`plugins\terminal` 分别提供内容实现参考。Cindy 的浏览器 WebView 池和 Electron IPC 不直接移植，本项目保留 Vue/Fastify 与现有 `agent-browser` 会话。

---

## 文件地图

| 文件 | 职责 |
| --- | --- |
| `apps/web/src/stores/workspace-tools.ts` | 按会话保存已打开工具、激活标签、临时预览目标和返回标签。 |
| `apps/web/src/components/WorkspaceToolPanel.vue` | 右侧面板空状态、标签栏、`+` 菜单、关闭与动态工具内容容器。 |
| `apps/web/src/components/WorkspaceToolSessionView.vue` | 按 session 常驻渲染其工具内容；会话切换时隐藏而不卸载，关闭标签时再移除对应组件。 |
| `apps/web/src/components/WorkspaceFileBrowser.vue` | 项目文件树与文件预览的组合布局。 |
| `apps/web/src/components/WorkspacePreviewTab.vue` | 复用 `FileViewer` 和 `KbCitationViewer` 展示临时预览。 |
| `apps/web/src/components/FileTree.vue` | 增加只读属性，隐藏创建/重命名/删除入口。 |
| `apps/web/src/components/WorkspaceBrowser.vue` | URL 工具栏、实时画面渲染、鼠标与键盘输入。 |
| `apps/web/src/components/WorkspaceTerminal.vue` | xterm.js UI、终端尺寸同步和会话连接状态。 |
| `apps/web/src/api/workspace-tools.ts` | 浏览器/终端 WebSocket 连接、认证子协议和帧协议类型。 |
| `apps/web/src/App.vue` | 面板开关、尺寸、当前会话、文件与引用预览事件集成。 |
| `apps/web/src/i18n/messages.ts` | 面板、文件、浏览器和终端的中英文文案。 |
| `apps/web/src/api/client.ts` | 浏览器面板启动、导航和关闭 API。 |
| `apps/web/package.json`、`apps/server/package.json`、`pnpm-lock.yaml` | xterm.js 和 node-pty 运行时依赖。 |
| `apps/server/src/browser/browser-session-manager.ts` | 确保面板与 Agent 复用同一浏览器实例并管理 stream。 |
| `apps/server/src/browser/browser-runtime.ts` | 保持现有浏览器启动配置与会话身份；不因面板而改变 Agent 当前的 headed/headless 行为。 |
| `apps/server/src/ws/browser.ts` | 验证会话并在前端与 agent-browser 本机 stream 间双向代理。 |
| `apps/server/src/routes/browser.ts` | 暴露面板启动、导航、状态和关闭接口，不隐式启用 Agent 权限。 |
| `apps/server/src/terminal/terminal-session-manager.ts` | 创建、复用、调整尺寸和清理每会话 PTY。 |
| `apps/server/src/ws/terminal.ts` | 验证会话并转发终端输入、输出、resize 与退出状态。 |
| `apps/server/src/wiring.ts`、`apps/server/src/types/fastify.d.ts` | 注册并声明浏览器/终端服务。 |
| `apps/server/src/routes/sessions.ts`、`apps/server/src/routes/trash.ts`、`apps/server/src/routes/projects.ts` | 删除会话、清理回收站或删除项目时清理 PTY。 |
| `apps/server/src/index.ts` | 服务关闭时等待 PTY 清理。 |

## 任务 1：搭建面板状态与标签 Shell

**文件：**
- 创建：`apps/web/src/stores/workspace-tools.ts`
- 创建：`apps/web/src/components/WorkspaceToolPanel.vue`
- 修改：`apps/web/src/App.vue`
- 修改：`apps/web/src/i18n/messages.ts`

- [x] **步骤 1：定义会话级面板状态**

在 Pinia store 中使用下列联合类型，按 `sessionId` 存储状态：

```ts
export type WorkspaceToolKind = "files" | "browser" | "terminal";
export type WorkspaceTabId = WorkspaceToolKind | "preview";

export type WorkspacePreviewTarget =
  | { kind: "file"; path: string }
  | { kind: "citation"; citation: KbCitationMeta };

interface WorkspaceSessionPanel {
  projectId: string;
  visible: boolean;
  tools: WorkspaceToolKind[];
  activeTab: WorkspaceTabId | null;
  returnTab: WorkspaceToolKind | null;
  preview: WorkspacePreviewTarget | null;
}
```

实现 `togglePanel(sessionId, projectId)`、`openTool(sessionId, projectId, kind)`（重复打开时只激活现有标签）、`closeTool(sessionId, kind)`、`showPreview(sessionId, projectId, target)` 和 `closePreview(sessionId)`。首次创建 session 面板状态时记住 `projectId`，之后从该面板状态向隐藏的 session view 传递项目目录。`visible` 区分“打开的空面板”和“已收起”；添加工具或预览时置为 `true`，关闭最后一个标签时置为 `false`。关闭激活工具时选择剩余工具的最后一个；没有标签时令 `activeTab` 为 `null`。

`showPreview` 仅在从持久工具切入预览时记录 `returnTab`；已在预览时改选目标不得覆盖返回目标。`closePreview` 在预览仍为活动项时恢复仍打开的 `returnTab`，否则保持当前标签；没有返回标签时清除激活标签并收起面板。`openTool` 从预览切走时保留原返回目标；关闭目标为 `returnTab` 的工具时将返回目标改为最后一个仍打开的持久工具，或清为 `null`。

- [x] **步骤 2：创建可注入工具组件的面板 Shell**

`WorkspaceToolPanel.vue` 接收当前 `sessionId`、`projectId`、`toolComponents`、面板宽度和当前激活项。空状态列出有注册组件的工具；有标签时只显示未打开类型的 `+` 菜单项。它为每个存在面板状态的 session 渲染一个 `WorkspaceToolSessionView.vue`，非当前 session 用 `v-show` 隐藏；每个 session view 再以 `v-show` 切换已打开标签。会话和工具切换因此都保留文件树、xterm 和浏览器组件实例；只有明确关闭标签或删除会话才卸载。

用组件 `expose({ dispose })` 约定处理显式关闭：面板隐藏或 session view 切换可见性时不释放资源；关闭标签时调用 `dispose()` 释放服务端资源，再移除标签；删除会话时卸载该 session view 并调用每个已打开工具的 `dispose()`。浏览器仅在不可见时断开画面流，终端保持 WebSocket 连接以保留隐藏期间的输出缓冲。

- [x] **步骤 3：接入现有右侧尺寸和面板开关**

在 `App.vue` 中把现有 `workspace-preview` 容器替换为 `WorkspaceToolPanel`，复用 `previewWidth`、`preview-resizer` 的宽度状态和拖动处理。增加工具面板开关按钮，调用 `togglePanel()`；隐藏时不删除已打开标签。关闭最后一个工具/预览标签时同步收起面板。

- [x] **步骤 4：加入基础中英文标签文案**

在 `apps/web/src/i18n/messages.ts` 的中文和英文对象中添加文件浏览器、浏览器、终端、预览、添加标签、关闭标签、打开面板和空状态文案。组件只通过 `t()` 读取界面文字。

- [x] **步骤 5：运行前端类型检查**

运行：`pnpm --filter @pi-web-ui/web typecheck`

预期：Vue/TypeScript 类型检查退出码为 `0`。

## 任务 2：实现只读文件浏览器和临时预览

**文件：**
- 创建：`apps/web/src/components/WorkspaceFileBrowser.vue`
- 创建：`apps/web/src/components/WorkspacePreviewTab.vue`
- 修改：`apps/web/src/components/FileTree.vue`
- 修改：`apps/web/src/App.vue`

- [x] **步骤 1：让 FileTree 支持只读展示**

增加可选属性 `readOnly?: boolean`，默认 `false`。`toTree()` 只在 `readOnly === false` 时渲染 rename/delete suffix；`nodeProps()` 在只读时不绑定 context menu。保留 Sidebar 现有创建、重命名、删除和文件打开行为。

- [x] **步骤 2：组合文件树与预览组件**

`WorkspaceFileBrowser.vue` 接收 `projectId`，内部渲染 `<FileTree :project-id="projectId" :read-only="true" @select="selectedPath = $event" />` 和 `<FileViewer :project-id="projectId" :path="selectedPath" hide-header />`。在文件区工具栏提供刷新按钮，调用 FileTree 暴露的 `refresh()`；选择文件后只更新文件浏览器内部预览。文件列表或读取失败时在各自区域显示可重试错误，重试沿用现有 list/read API。

- [x] **步骤 3：迁移文件和知识库引用预览到临时标签**

`WorkspacePreviewTab.vue` 根据 `WorkspacePreviewTarget.kind` 渲染 `FileViewer` 或 `KbCitationViewer`。在 `App.vue` 中把 Sidebar/ChatPanel 的文件事件接到 `showPreview(sessionId, projectId, { kind: "file", path })`，把引用事件接到 `showPreview(sessionId, projectId, { kind: "citation", citation })`。重复调用只更新同一个 `preview` 标签；关闭活动预览时恢复仍存在的 `returnTab`，如果用户已切换到其他标签则关闭预览不改变当前选中标签。

- [x] **步骤 4：把文件浏览器注册到工具 Shell**

向 `WorkspaceToolPanel` 的 `toolComponents` 传入 `files: WorkspaceFileBrowser`，向标签内容传入会话所属 `projectId`。使用会话 ID 与工具类型组成 Vue key，避免不同会话共用 FileTree 的内部选中状态。

- [x] **步骤 5：运行前端类型检查**

运行：`pnpm --filter @pi-web-ui/web typecheck`

预期：新增 props、组件事件和临时预览目标类型全部通过检查。

## 任务 3：为共享浏览器提供会话流代理

**文件：**
- 修改：`apps/server/src/browser/browser-session-manager.ts`
- 检查：`apps/server/src/browser/browser-runtime.ts`
- 修改：`apps/server/src/routes/browser.ts`
- 创建：`apps/server/src/ws/browser.ts`
- 修改：`apps/server/src/wiring.ts`
- 修改：`apps/server/src/types/fastify.d.ts`

- [x] **步骤 1：让面板启动与 Agent 使用相同实例**

在 `BrowserSessionManager` 增加按 session ID 的 `ensurePanelSession()`、`navigate()`、`back()`、`forward()`、`reload()` 和 `closePanelSession()`。所有 CLI 调用使用已有 `browserIdentity()` 和 `browserEnvironment()`；确保实例时使用同一个 namespace/session，缺少活动页面时执行 `agent-browser open about:blank`，之后执行 `stream enable` 和 `stream status --json` 并保存本机流端口。将面板启动的实例纳入现有 manager 状态及 `close()`/`shutdown()` 清理路径。

- [x] **步骤 2：保持现有浏览器启动模式**

检查 `browserEnvironment()` 对 `PI_BROWSER_HEADLESS`、`AGENT_BROWSER_CONFIG`、session 和 namespace 的配置，面板启动、流代理与 Agent 扩展全部调用现有同一份会话配置；不修改 `headed` 默认值，不新建第二个 browser identity。

- [x] **步骤 3：增加面板控制 API**

在 `browserRoutes` 中增加会话存在性校验后的面板启动/关闭/导航操作；这些用户操作不能调用现有 `PUT /sessions/:id/browser`，因为该路由会改变 Agent 插件启用状态并重启 Agent。导航 URL 只接受 `http:`、`https:` 和 `about:blank`。

- [x] **步骤 4：代理实时流并隔离会话**

新增 `/ws/browser/:sessionId` Fastify WebSocket 路由。用 `app.sessions.findById(sessionId)` 验证会话，再以 `BrowserSessionManager` 返回的 `127.0.0.1` 流端口建立服务端 WebSocket。双向转发 agent-browser 消息；客户端帧必须是 JSON 对象，只允许已知消息类型 `input_mouse`、`input_keyboard`、`input_touch`、`config`、`ack`，校验数字字段为有限值并限制文本帧为 64 KiB；在任一侧关闭时关闭另一侧连接。

agent-browser 服务端帧包括 `frame`、`status`、`tabs`、`url`；使用其 `pacing=ack` 机制限制浏览器帧积压。浏览器进程端口保持 loopback，前端不直接连接本机随机端口。

- [x] **步骤 5：注册路由及服务装饰**

在 `wiring.ts` 注册 browser WebSocket route 并装饰已存在的 `browserManager`；更新 `types/fastify.d.ts` 使新路由可以调用 `ensurePanelSession()` 和 stream proxy 所需的状态查询。

- [x] **步骤 6：运行服务端类型检查**

运行：`pnpm --filter @pi-web-ui/server typecheck`

预期：BrowserSessionManager、WebSocket 路由和 Fastify 装饰类型通过检查。

## 任务 4：实现浏览器标签 UI

**文件：**
- 创建：`apps/web/src/components/WorkspaceBrowser.vue`
- 创建：`apps/web/src/api/workspace-tools.ts`
- 修改：`apps/web/src/api/client.ts`
- 修改：`apps/web/src/components/WorkspaceToolPanel.vue`
- 修改：`apps/web/src/App.vue`
- 修改：`apps/web/src/i18n/messages.ts`

- [x] **步骤 1：实现带现有认证协议的 API 客户端**

`workspace-tools.ts` 使用 `webSocketUrl()` 和 `authToken()` 创建 socket：`new WebSocket(url, token ? ["pi-web-ui", token] : ["pi-web-ui"])`。定义浏览器控制消息类型和面板 API 请求封装；URL、状态与错误使用结构化对象，不拼接 HTML。

- [x] **步骤 2：渲染流帧并转发用户输入**

`WorkspaceBrowser.vue` 连接 `/ws/browser/:sessionId`，发送 `{"type":"config","pacing":"ack","maxFps":10}`。解析 `frame` 的 base64 JPEG，在画面绘制完成后回传 `{"type":"ack","seq":N}`。把画面内的 pointer/key/touch 事件转换为 agent-browser 的 `input_mouse`、`input_keyboard`、`input_touch` 消息，并按画面缩放比例换算坐标。遇到断线时显示重连状态，提供一次明确的重连操作；底层浏览器会话不存在时提示关闭后重新打开标签。

- [x] **步骤 3：加入导航工具栏和生命周期**

实现受控 URL 输入框、Go、Back、Forward、Reload 按钮。连接成功后调用 `ensurePanelSession()`；标签切换为非活动时断开 stream socket 但不关闭浏览器；组件 `dispose()` 调用面板关闭 API，关闭标签时释放会话实例。页面 `url`/`status` 消息更新地址栏和连接状态。

- [x] **步骤 4：注册浏览器组件**

将 `browser: WorkspaceBrowser` 注册到 `WorkspaceToolPanel`，传入当前 session ID 和活动状态。打开标签时只启动/连接浏览器，不更改 `browser-use` 插件权限；Agent 工具仍通过现有扩展按同一 session identity 操作页面。

- [x] **步骤 5：运行服务端与前端类型检查**

运行：

```text
pnpm --filter @pi-web-ui/server typecheck
pnpm --filter @pi-web-ui/web typecheck
```

预期：两条命令均退出码为 `0`。

## 任务 5：实现 PTY 服务与清理

**文件：**
- 修改：`apps/server/package.json`
- 修改：`pnpm-lock.yaml`
- 创建：`apps/server/src/terminal/terminal-session-manager.ts`
- 创建：`apps/server/src/ws/terminal.ts`
- 修改：`apps/server/src/wiring.ts`
- 修改：`apps/server/src/types/fastify.d.ts`
- 修改：`apps/server/src/routes/sessions.ts`
- 修改：`apps/server/src/routes/trash.ts`
- 修改：`apps/server/src/routes/projects.ts`
- 修改：`apps/server/src/index.ts`

- [ ] **步骤 1：添加 PTY 运行时依赖**

运行：`pnpm --filter @pi-web-ui/server add node-pty`

使用 pnpm 更新 workspace lockfile；不要手工修改锁文件。

- [ ] **步骤 2：建立每会话一个 PTY 的管理器**

`TerminalSessionManager` 使用 `Map<string, { pty: IPty; output: string[]; outputBytes: number }>` 以 `sessionId` 索引进程。公开 `ensure(sessionId, projectWorkdir)`、`write(sessionId, data)`、`resize(sessionId, cols, rows)`、`recentOutput(sessionId)`、`close(sessionId)`、`shutdown()`。PTY `onData` 同时向当前 socket 广播并将最近 256 KiB 输出存入有界缓冲；新 socket 连接时先发送该缓冲，再接收实时输出。使用 `node-pty.spawn(shell, [], { cwd: project.workdir, cols: 80, rows: 24, name: "xterm-256color", env: { ...process.env, TERM: "xterm-256color" } })`。Windows shell 取 `COMSPEC`，Unix shell 取 `SHELL` 并回退 `/bin/sh`。

- [ ] **步骤 3：创建会话验证和消息校验的 WebSocket**

新增 `/ws/terminal/:sessionId`。路由先解析 session 与其 project workdir，再 `ensure()`。客户端只可发送 `{type:"input", data:string}`、`{type:"resize", cols:number, rows:number}` 和 `{type:"close"}`；截断超过 8 KiB 的单条输入，并把 cols 限制为 20–300、rows 限制为 5–100。PTY 输出以 WebSocket binary frame 发送；退出时发送 `{type:"exit", exitCode:number, signal:number}`。`close` 明确终止该会话 PTY，普通 socket 断开只允许重连，不终止 PTY。

- [ ] **步骤 4：接入应用生命周期清理**

在 `wiring.ts` 创建并装饰 `terminalManager`，注册终端 WebSocket。会话永久删除、清空回收站、项目删除和 server close 时都调用 `close(sessionId)` 或 `shutdown()`。收到客户端连接时必须从服务端 session/project 关系取 cwd；禁止接受客户端提交的 cwd 或另一个 session ID。

- [ ] **步骤 5：运行服务端类型检查**

运行：`pnpm --filter @pi-web-ui/server typecheck`

预期：PTY API 类型、Fastify 装饰和所有生命周期清理路径通过检查。

## 任务 6：实现终端 UI 并完成标签注册

**文件：**
- 修改：`apps/web/package.json`
- 修改：`pnpm-lock.yaml`
- 创建：`apps/web/src/components/WorkspaceTerminal.vue`
- 修改：`apps/web/src/api/workspace-tools.ts`
- 修改：`apps/web/src/components/WorkspaceToolPanel.vue`
- 修改：`apps/web/src/i18n/messages.ts`

- [ ] **步骤 1：添加 xterm.js 及尺寸适配依赖**

运行：`pnpm --filter @pi-web-ui/web add @xterm/xterm @xterm/addon-fit`

- [ ] **步骤 2：初始化终端并适配面板尺寸**

组件中创建 `Terminal({ convertEol: true, cursorBlink: true })`，载入 `FitAddon`，在容器挂载后 `open()` 并 `fit()`；ResizeObserver 回调重新 `fit()` 后发送 `{type:"resize", cols:term.cols, rows:term.rows}`。组件销毁时 dispose xterm 和 observer。

- [ ] **步骤 3：连接和终止远端 PTY**

使用 `workspace-tools.ts` 连接 `/ws/terminal/:sessionId`，认证子协议与浏览器相同。将 `term.onData()` 发送为 input JSON，将 text/binary 输出帧写入 `term.write()`；连接重建时按 session ID 重新连接旧 PTY，并先重放 manager 的有界输出缓冲。显式关闭标签时发送 `{type:"close"}` 并关闭 socket；工具切换、面板隐藏和 session 切换都保留组件与 socket，以便 xterm 累积完整输出。

- [ ] **步骤 4：注册终端组件并完成文案**

注册 `terminal: WorkspaceTerminal`，使空状态和 `+` 菜单显示三个工具；close 操作调用组件的 `dispose()`。添加终端连接中、重连、已结束、重开等中英文状态提示。

- [ ] **步骤 5：运行前端类型检查**

运行：`pnpm --filter @pi-web-ui/web typecheck`

预期：xterm API、WebSocket 消息和动态组件 props 通过检查。

## 任务 7：完成生命周期接线与桌面打包兼容

**文件：**
- 检查：`apps/desktop/scripts/prepare-sidecar.mjs`
- 检查：`apps/desktop/scripts/runtime-files.mjs`
- 修改：`apps/web/src/App.vue`
- 修改：`apps/server/src/wiring.ts`
- 修改：`apps/server/src/routes/sessions.ts`
- 修改：`apps/server/src/routes/trash.ts`
- 修改：`apps/server/src/routes/projects.ts`
- 修改：`apps/server/src/index.ts`

- [ ] **步骤 1：统一 session 资源销毁路径**

删除会话、永久清空回收站、删除项目时，对受影响 session 调用 `terminalManager.close(sessionId)`；浏览器清理继续由已有 `browserManager.close(sessionId)` 负责。Fastify `onClose` 钩子等待 `terminalManager.shutdown()` 完成。临时断开 WebSocket 不触发 PTY 清理。

- [ ] **步骤 2：接入当前会话 UI 与临时预览**

在 `App.vue` 以当前 session id、其 project id 驱动面板；`openTool()` 和 `showPreview()` 首次初始化该 session 状态时保存 project id，因此即使当前项目切换、sessionStore 载入另一项目的会话列表，旧 session view 仍有正确项目路径。会话切换只切换可见的 session view。文件与引用事件传入当前 session 的 `showPreview()`；session 删除时调用已打开组件的 `dispose()`，再从 store 移除其状态并卸载工具视图。

- [ ] **步骤 3：保留桌面 sidecar 对 native 依赖的部署方式**

检查 `apps/desktop/scripts/prepare-sidecar.mjs` 的 `pnpm deploy --prod` 会包含服务端 `node-pty` 依赖；`runtime-files.mjs` 会在 pnpm 重装和归档前复制、恢复所有 `.node` 原生文件。该流程无需依赖 allowlist。桌面打包构建命令为 `pnpm --filter @pi-web-ui/desktop build:debug`。

- [ ] **步骤 4：运行服务端和前端类型检查**

运行：

```text
pnpm --filter @pi-web-ui/server typecheck
pnpm --filter @pi-web-ui/web typecheck
```

预期：两条命令均退出码为 `0`。
