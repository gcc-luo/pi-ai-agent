# 更新公告弹窗主题适配设计

## 背景

当前桌面端发现新版本后使用 `UpdateDialog.vue` 展示版本号、发布日期和原始更新说明。现有弹窗尺寸较小，更新说明以纯文本显示，长内容会被截断为固定高度，难以承载带有标题、列表和分组的 GitHub Release 内容。

本次改造参考 Cindy 的更新公告阅读体验：把版本信息、摘要、分组更新条目和操作动作组织成一个有明确阅读节奏的发布面板，同时适配项目已有的浅色、深色和灰色主题。

## 范围

### 包含

- 改造 `apps/web/src/components/UpdateDialog.vue` 的公告展示层。
- 使用项目现有 `renderMarkdown()` 将更新正文转换为安全的 Markdown HTML。
- 为更新公告增加结构化的标题、版本元信息、摘要、正文和底部操作区样式。
- 将长更新正文限制在弹窗内容区域内滚动，底部操作区保持可见。
- 使用现有主题语义变量适配 `light`、`dark`、`gray` 三种主题。
- 保留下载、安装、重启、稍后处理和错误处理的现有状态流转。
- 增加公告渲染与关键状态操作的组件测试。

### 不包含

- 不修改 Tauri updater 配置、更新地址、版本检查逻辑或下载协议。
- 不修改 `useUpdateStore` 的状态定义和方法签名。
- 不新增 Release API 或额外的网络请求。
- 不改变设置页“检查更新”入口和侧栏自动弹出条件。
- 不改变全局主题色板，只在弹窗内部消费已有变量。

## 设计方案

### 1. 视觉结构

更新公告使用居中的重型弹窗，延续 `NModal` 的遮罩、关闭和焦点行为。弹窗内部由四个区域组成：

1. 顶部栏：展示 PI 发布标识、公告标题和关闭按钮。
2. 内容区：展示版本徽章、发布日期、更新摘要和 Markdown 正文。
3. 正文区：由 Markdown 标题、段落、列表、链接等元素组成，使用细分隔线建立章节层级；不额外制造每条更新的独立卡片。
4. 底部操作区：在可用、准备安装等状态下放置次要操作和主操作；下载进度、安装中和错误状态复用同一面板宽度。

公告弹窗宽度使用 `min(760px, calc(100vw - 32px))`，整体最大高度使用视口约束，内容区使用 `overflow-y: auto`。在窄窗口下，正文中的贡献者或元信息允许换行，操作按钮保持可点击且不溢出。

### 2. 主题适配

“沉浸式”只描述信息层级和阅读氛围，不表示强制使用黑色。组件不写死白色、黑色或固定透明度，而是使用现有语义变量：

| 用途 | 变量 |
| --- | --- |
| 弹窗与页面层级 | `--bg-deep`、`--bg-surface`、`--bg-elevated` |
| 主要、次要和弱化文字 | `--text-primary`、`--text-secondary`、`--text-muted` |
| 分隔线和边界 | `--border-default`、`--border-subtle` |
| 版本徽章和主操作 | `--accent`、`--accent-dim`、`--accent-hover` |
| 错误状态 | `--rose`、`--rose-dim` |
| 下载进度轨道 | `--bg-hover` |

浅色主题以清晰的白色面板和浅灰边界呈现；深色和灰色主题以现有深色表面和绿色强调色呈现。三种主题保持相同的结构、间距和操作语义。

### 3. 数据与渲染

`updateStore.updateInfo` 继续作为唯一数据来源：

- `version` 进入版本徽章。
- `date` 进入发布日期；为空时隐藏日期节点。
- `body` 通过 `renderMarkdown()` 渲染到公告正文。

`renderMarkdown()` 已经使用 `marked` 和 `DOMPurify`，因此公告正文不新增 HTML 解析器或不安全的 `innerHTML` 处理。公告正文的专属样式限定在 `.update-notes-content` 内，避免影响聊天消息、文件预览和技能详情的 Markdown 样式。

空正文时保留版本信息和操作区，不渲染空的更新说明标题。Markdown 渲染后的标题、列表、段落、代码块和链接都需要保持可读；外链继续复用现有安全属性。

### 4. 状态与交互

现有状态行为保持不变：

- `available`：显示完整公告和“稍后更新 / 下载并安装”。
- `downloading`：显示下载提示、进度条和百分比，不展示安装按钮。
- `ready`：显示安装就绪提示和“稍后更新 / 重启并完成更新”。
- `installing`：显示安装中提示。
- `error`：显示本地化错误标题、原始错误详情和关闭操作。

“稍后更新”继续调用 `updateStore.reset()` 并发出 `close`；下载和重启按钮继续调用当前组件已有的 store 方法。弹窗关闭事件继续执行 reset，避免残留待安装更新对象。

按钮增加 `type="button"`、可读的本地化文本和禁用状态约束；下载、安装和关闭过程中的状态文本使用 `aria-live="polite"`，不改变现有 `NModal` 的键盘关闭和焦点返回机制。

### 5. 动效与可访问性

- 保留 `NModal` 的进入和退出动画，不增加循环动画。
- 更新正文滚动不依赖悬停，键盘和触控设备都能访问完整内容。
- 主标题使用单一 `h3`，正文标题依赖 Markdown 语义层级。
- 关闭按钮提供 `aria-label`，图标仅作装饰。
- 颜色只用于强调和状态，正文、版本号和错误消息同时通过文本表达含义。
- 在 `prefers-reduced-motion` 下依赖组件及全局现有降级行为，不添加必须依赖动画的交互。

## 文件边界

- 修改：`apps/web/src/components/UpdateDialog.vue`
  - 只负责公告弹窗模板、状态分支和局部样式。
  - 引入并调用 `renderMarkdown()`，不承载版本检查或安装逻辑。
- 修改：`apps/web/src/i18n/messages.ts`
  - 仅在现有文案不足以表达新结构时补充文案；复用已有更新按钮和状态文案。
- 新增：`apps/web/src/components/UpdateDialog.test.ts`
  - 验证版本信息、Markdown 正文、按钮动作、进度状态和错误状态。

如果实现过程中发现现有 Markdown 样式无法安全复用，新增局部 CSS 选择器即可；不抽取全局 Markdown 主题，也不重构其他弹窗。

## 测试策略

组件测试使用 Vue Test Utils + Vitest，并 mock `NModal`、`NProgress` 和 `useUpdateStore`，避免测试依赖 Tauri runtime。测试至少覆盖：

1. `available` 状态显示版本号、日期、Markdown 标题和列表。
2. 更新正文为空时不显示空的更新说明区域。
3. 点击“稍后更新”会 reset store 并触发 close 事件。
4. 点击“下载并安装”调用 `downloadAndInstall()`。
5. `downloading` 显示进度与百分比。
6. `ready` 点击重启按钮调用 `installAndRestart()`。
7. `error` 显示错误详情并能关闭。

验证命令：

```bash
pnpm --filter @pi-web-ui/web test -- UpdateDialog.test.ts
pnpm --filter @pi-web-ui/web typecheck
pnpm --filter @pi-web-ui/web build
```

完成后在开发环境分别切换 `light`、`dark`、`gray` 主题，检查弹窗边界、正文滚动、按钮对比度和窄窗口布局。

## 验收标准

- 更新公告阅读体验具备明确的标题、版本元信息、正文层级和底部动作区域。
- GitHub Release 风格的 Markdown 更新说明不会再以未格式化纯文本堆叠。
- 三种主题下均无硬编码导致的低对比度、白底黑字错配或绿色按钮不可读问题。
- 长内容只在公告正文区域滚动，底部操作按钮始终可见。
- 现有更新 store 测试保持通过，组件测试覆盖新增展示行为。
- 更新检测、下载、安装、重启和错误状态的调用路径与改造前一致。
