# 定时任务复用 ChatPanel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让自动提问定时任务直接复用 ChatPanel 的真实对话输入区和能力工具栏，并持久化技能、插件、连接器、专家快照，在每次执行时按快照调用。

**Architecture:** 从 ChatPanel 抽出共享 ChatComposer，普通会话与定时任务分别使用 session 模式和受控草稿模式。定时任务新增能力快照字段；服务端执行时过滤失效能力、配置任务会话，并通过 ConnectorService 的会话 allowlist 限制连接器范围。

**Tech Stack:** Vue 3、Pinia、Naive UI、TypeScript、Fastify、better-sqlite3、Vitest、pnpm monorepo。

---

## 文件职责

- `packages/shared/src/types.ts`：新增定时任务能力快照类型并扩展 DTO。
- `apps/server/src/db/migrations.ts`：新增能力快照列。
- `apps/server/src/db/repositories/scheduled-task.ts`：读写快照 JSON。
- `apps/server/src/routes/scheduled-tasks.ts`：校验并转发能力快照。
- `apps/server/src/services/task-executor.ts`：应用快照到会话、技能、插件、专家和连接器范围。
- `apps/server/src/connectors/connector-service.ts`：维护会话级连接器 allowlist，并在搜索/描述/调用时强制过滤。
- `apps/server/src/routes/connectors.ts`：把 sessionId 传给连接器服务查询。
- `apps/server/src/wiring.ts`、`apps/server/src/types/fastify.d.ts`：注入任务执行依赖。
- `apps/web/src/components/ChatComposer.vue`：承载 ChatPanel 原有输入区和工具栏。
- `apps/web/src/components/ChatPanel.vue`：改用共享 ChatComposer，保持现有会话发送行为。
- `apps/web/src/components/SkillSelect.vue`、`PluginSelect.vue`、`ConnectorSelect.vue`、`ChatExpertPicker.vue`：增加受控草稿模式，保留默认 session 模式。
- `apps/web/src/components/CreateScheduledTaskDialog.vue`：用 ChatComposer 替换自动提问的独立 textarea，并提交快照。
- `apps/web/src/api/client.ts`、`apps/web/src/stores/scheduled-tasks.ts`：扩展创建/更新请求类型。
- `apps/web/src/i18n/messages.ts`：补充能力快照和失效提示文案。
- 对应 `apps/server/tests`、`apps/web/tests`：先写失败测试，再实现行为。

### Task 1: 定义能力快照并增加数据库持久化

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `apps/server/src/db/migrations.ts`
- Modify: `apps/server/src/db/repositories/scheduled-task.ts`
- Test: `apps/server/tests/unit/scheduled-task-repository.test.ts`

- [ ] **Step 1: 写 repository 失败测试**：创建带 `skillNames`、`pluginIds`、`connectorIds`、`expertId` 的任务，断言 `findById` 和 `list` 返回相同快照；再验证不传快照返回空结构。
- [ ] **Step 2: 运行测试确认失败**：运行 `pnpm --filter @pi-web-ui/server exec vitest run tests/unit/scheduled-task-repository.test.ts`，预期因类型和数据库列不存在失败。
- [ ] **Step 3: 增加共享类型与迁移**：增加 `ScheduledTaskCapabilities`，DTO 增加 `capabilities`；新增 `028_scheduled_task_capabilities`，添加 `capabilities_json` 默认 `{}`。
- [ ] **Step 4: 实现 repository 序列化**：为 row 增加 `capabilities_json`，安全解析为去重数组和 null；`create/update` 写入 JSON；对旧数据库/空值返回空快照。
- [ ] **Step 5: 运行测试确认通过**：重新运行同一测试，预期全部通过。

### Task 2: 扩展 API 与前端任务 store 类型

**Files:**
- Modify: `apps/server/src/routes/scheduled-tasks.ts`
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/stores/scheduled-tasks.ts`
- Test: `apps/server/tests/integration/scheduled-tasks.test.ts`

- [ ] **Step 1: 写路由失败测试**：覆盖自动提问创建/更新接收能力快照、提醒任务清空快照、非数组 ID 和重复值校验。
- [ ] **Step 2: 运行测试确认失败**：运行 `pnpm --filter @pi-web-ui/server exec vitest run tests/integration/scheduled-tasks.test.ts`，预期能力字段未被保存或校验不成立。
- [ ] **Step 3: 实现服务端校验**：新增快照校验函数；自动提问保存规范化快照，提醒任务强制保存空快照；响应 DTO 返回完整结构。
- [ ] **Step 4: 扩展前端请求类型**：创建和更新方法增加 `capabilities`，store 的 create/update input 同步扩展。
- [ ] **Step 5: 运行路由测试确认通过**：重新运行测试，预期全部通过。

### Task 3: 抽取 ChatComposer 并支持受控草稿模式

**Files:**
- Create: `apps/web/src/components/ChatComposer.vue`
- Modify: `apps/web/src/components/ChatPanel.vue`
- Modify: `apps/web/src/components/SkillSelect.vue`
- Modify: `apps/web/src/components/PluginSelect.vue`
- Modify: `apps/web/src/components/ConnectorSelect.vue`
- Modify: `apps/web/src/components/ChatExpertPicker.vue`
- Test: `apps/web/tests/unit/chat-composer.test.ts`

- [ ] **Step 1: 写共享组件失败测试**：挂载草稿模式，断言工具栏仍渲染原有按钮；选择技能/插件/连接器/专家后，组件一次性 emit 草稿快照；普通 session 模式仍触发现有 session API。
- [ ] **Step 2: 运行测试确认失败**：运行 `pnpm --filter @pi-web-ui/web exec vitest run tests/unit/chat-composer.test.ts`，预期组件不存在或事件不匹配。
- [ ] **Step 3: 抽出 ChatPanel 输入区**：保持现有 class、DOM 顺序、按钮和样式；通过 props/emits 区分 `session` 与 `draft`，不复制第二套视觉实现。
- [ ] **Step 4: 为选择器增加 draft 受控接口**：技能多选沿用现有 chip；插件/连接器改为受控 ID 多选；专家改为受控单选；默认未传 draft props 时保持现有 session 行为。
- [ ] **Step 5: 让 ChatPanel 使用共享组件**：删除重复的输入区逻辑，只保留消息展示、运行状态和发送回调；确保普通聊天行为和现有测试不变。
- [ ] **Step 6: 运行前端相关测试确认通过**：运行 `pnpm --filter @pi-web-ui/web exec vitest run tests/unit/chat-composer.test.ts src/components/ChatPanel.test.ts tests/unit/chat-panel-running-input.test.ts`。

### Task 4: 接入定时任务编辑弹框

**Files:**
- Modify: `apps/web/src/components/CreateScheduledTaskDialog.vue`
- Modify: `apps/web/src/i18n/messages.ts`
- Test: `apps/web/tests/unit/create-scheduled-task-dialog.test.ts`

- [ ] **Step 1: 写弹框失败测试**：自动提问显示 ChatComposer；打开编辑任务恢复 payload 和四类能力快照；提交时输出规范化快照；提醒模式隐藏 ChatComposer 并输出空快照。
- [ ] **Step 2: 运行测试确认失败**：运行 `pnpm --filter @pi-web-ui/web exec vitest run tests/unit/create-scheduled-task-dialog.test.ts`，预期现有 textarea 行为无法满足快照断言。
- [ ] **Step 3: 替换 prompt textarea**：自动提问使用 ChatComposer 的 draft 模式；任务字段继续使用现有表单与 CronPicker；将项目 ID传给连接器选择器；保留原有校验。
- [ ] **Step 4: 增加快照展示和失效状态**：编辑时保留快照 ID；能力已不存在时显示轻量警告，但允许保存；不在弹框里修改全局插件/连接器开关。
- [ ] **Step 5: 运行弹框测试确认通过**：重新运行同一测试并确认已有 scheduled task 相关测试不回归。

### Task 5: 实现任务执行时的能力应用与失效跳过

**Files:**
- Modify: `apps/server/src/services/task-executor.ts`
- Modify: `apps/server/src/wiring.ts`
- Modify: `apps/server/src/types/fastify.d.ts`
- Test: `apps/server/tests/unit/task-executor.test.ts`

- [ ] **Step 1: 写执行器失败测试**：断言有效技能转成 `/skill:name`，有效插件写入任务会话，专家写入任务会话，失效能力进入警告，原始提示词仍被发送。
- [ ] **Step 2: 运行测试确认失败**：运行 `pnpm --filter @pi-web-ui/server exec vitest run tests/unit/task-executor.test.ts`，预期执行器尚未接收能力快照依赖。
- [ ] **Step 3: 注入依赖并实现解析**：注入 `SkillService`、`PluginManager`、`ConnectorService`、`ExpertRepository`；创建/复用 session 后应用有效能力；任务重试保持同一快照语义。
- [ ] **Step 4: 将警告拼接到任务输出**：将 `能力警告：...` 放入返回 output 和 task log，错误能力不抛出；没有有效能力时仍执行原始 prompt。
- [ ] **Step 5: 运行执行器测试确认通过**：重新运行同一测试，预期全部通过。

### Task 6: 限制定时任务的连接器范围

**Files:**
- Modify: `apps/server/src/connectors/connector-service.ts`
- Modify: `apps/server/src/routes/connectors.ts`
- Modify: `apps/server/src/services/task-executor.ts`
- Test: `apps/server/tests/unit/connector-service.test.ts`

- [ ] **Step 1: 写 allowlist 失败测试**：任务 session 只配置连接器 A 时，search/describe/invoke 对 B 返回 `TOOL_NOT_FOUND` 或策略拒绝；普通 session 仍可访问项目内所有已启用连接器。
- [ ] **Step 2: 运行测试确认失败**：运行 `pnpm --filter @pi-web-ui/server exec vitest run tests/unit/connector-service.test.ts`，预期当前实现仍返回所有已启用连接器。
- [ ] **Step 3: 实现 session allowlist**：ConnectorService 增加设置/清理 session 范围；search、describe、invoke 和 compound resolve 都按 sessionId 过滤；无范围时保持原行为。
- [ ] **Step 4: 传递 sessionId**：内部连接器路由将 `req.params.sessionId` 传入 service；TaskExecutor 在运行前设置，finally 中清理。
- [ ] **Step 5: 运行连接器测试确认通过**：重新运行同一测试以及连接器路由相关测试。

### Task 7: 全量验证与整理

**Files:**
- Modify: only files required by previous tasks
- Test: full workspace test/typecheck/build commands

- [ ] **Step 1: 运行全量测试**：`pnpm test`，记录 Web/Server 测试文件、测试数和失败数。
- [ ] **Step 2: 运行类型检查**：`pnpm typecheck`，确认共享类型、Vue props 和服务端依赖无类型错误。
- [ ] **Step 3: 运行构建**：`pnpm build`，确认生产构建成功。
- [ ] **Step 4: 检查差异**：`git diff --check`、`git status --short`，确认没有覆盖用户已有的 `ScheduledTasksView.vue` 修改，也没有提交 `.superpowers/brainstorm` 临时产物。
