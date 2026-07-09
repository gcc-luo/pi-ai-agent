# 项目编辑与删除 — 设计文档

- 日期：2026-07-09
- 范围：为 pi-web-ui 的「项目」补充编辑（重命名）与删除能力
- 状态：已确认，待实现

## 1. 背景与现状缺口

pi-web-ui 当前已有项目列表、新建项目、文件浏览、模型管理、会话与 agent 桥接等能力，但项目层面缺少编辑与删除闭环：

- 后端 `apps/server/src/routes/projects.ts`：已有 `POST / GET / GET:id / DELETE`，**缺 `PUT /:id`（编辑）**
- `ProjectRepository.update()` 已存在但只允许改 `name` / `description`，刻意排除 `workdir`，且未暴露到任何路由
- 前端 `api/client.ts` 与 `stores/project.ts`：`deleteProject` 已实现但**未在任何 UI 上暴露**；`update` 完全缺失
- `Sidebar.vue` 项目列表项只有选中态，没有编辑/删除入口

## 2. 决策

| 维度 | 决策 | 理由 |
|------|------|------|
| 编辑范围 | 只改 `name`（即「重命名」） | `workdir` 是项目根路径，改它会让已索引文件树、会话相对路径全部错位；`description` 本版不开放，保持最小可用 |
| 删除语义 | 软删除（`deleted_at` 置位） | 用户已预告后续会加「回收站」功能；软删为回收站铺路，未来只需补恢复入口与回收站列表页，几乎零迁移 |
| 进程清理 | 删除项目时杀该项目下所有 agent 进程 | 用户视角项目已消失，运行中的 agent 必须停；孤儿进程不可接受 |
| 入口 UI | 侧栏项目列表项 hover 浮出编辑/删除图标按钮 | 与现有 `session-status-dot`、`section-action` 视觉风格一致；发现性好 |

**回收站是后续功能，本版不做。** 软删的 DB 记录保留是内部实现细节，前端 UI 不向用户承诺「可恢复」，避免误导（回收站 UI 上线后再改文案）。

## 3. 后端改动

### 3.1 Schema 迁移

`apps/server/src/db/migrations.ts`：

- `projects` 表新增 `deleted_at INTEGER`（可空，默认 NULL）

### 3.2 `ProjectRepository`（`apps/server/src/db/repositories/project.ts`）

- `list()`：`SELECT * FROM projects WHERE deleted_at IS NULL ORDER BY updated_at DESC`
- `findById(id)`：`SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL`
- `update(id, patch)`：签名不变（仍接受 `name` / `description` patch）；路由层只传 `{ name }`
- `delete(id)`：从 `DELETE FROM projects WHERE id = ?` 改为 `UPDATE projects SET deleted_at = ? WHERE id = ?`（`deleted_at = Date.now()`）

不为本版暴露 `findByIdIncludingDeleted`（YAGNI，回收站时再加）。

### 3.3 路由 `apps/server/src/routes/projects.ts`

**新增 `PUT /:id`**：

- body：`{ name: string }`
- 校验：`name` 非空字符串，否则 400
- 逻辑：`app.projects.findById(id)` → 不存在返回 404；`app.projects.update(id, { name })`；返回更新后的 project（200）

**修改 `DELETE /:id`**：

- 顺序：
  1. `app.projects.findById(id)` → 不存在返回 404
  2. 遍历 `app.sessionStates`，找出 `projectId === id` 的所有会话
  3. 对每个匹配会话：kill agent 进程 + 从 `sessionStates` 清理（复用现有终止会话逻辑）
  4. `app.projects.delete(id)`（软删，置 `deleted_at`）
  5. 返回 204

## 4. 前端改动

### 4.1 `api/client.ts`

- 新增 `updateProject(id: string, name: string)` → `PUT /projects/${id}` body `{ name }`，返回 `ProjectDto`
- `deleteProject(id)` 已存在，签名不变（后端语义从硬删改软删，前端无感）

### 4.2 `stores/project.ts`

- 新增 `update(id: string, name: string)` action：调 `api.updateProject`，用返回值替换 `state.projects` 中对应项；返回更新后的 project
- `remove(id)` 不变：仍调 `api.deleteProject` + 本地过滤
- 失败处理：catch 错误，不改本地状态，向上抛出由调用方提示

### 4.3 新增组件

**`RenameProjectDialog.vue`**：

- 单输入弹窗，结构镜像 `NewProjectDialog.vue`
- props：`show: boolean`、`project: ProjectDto | null`
- 预填 `project.name`，打开时聚焦选中文本
- 空名时 Save 按钮置灰
- emit：`close`、`rename(name: string)`

**`ConfirmDialog.vue`**（通用）：

- props：`show: boolean`、`title: string`、`message: string`、`confirmLabel: string`、`danger: boolean`
- emit：`confirm`、`close`
- 本版用于删除确认；设计为通用，后续会话删除、文件覆盖等可复用

### 4.4 `Sidebar.vue` 改动

- 每个 `list-item` 右侧新增 `item-actions` 容器，含两个图标按钮：编辑（铅笔）、删除（垃圾桶）
- `item-actions` 默认 `opacity: 0`；`.list-item:hover` / `.list-item:focus-within` 下显 `opacity: 1`
- 图标按钮 `@click.stop` 阻止冒泡到 `list-item` 的 `select-project`
- 点击编辑：打开 `RenameProjectDialog`，传入当前 project；`rename` 事件 → `projectStore.update(id, name)` → 成功后关闭
- 点击删除：打开 `ConfirmDialog`，消息「确认删除该项目？项目下所有运行中的会话将被停止。」；`confirm` 事件 → `projectStore.remove(id)` → 成功后关闭
- 删除当前选中项目后：`selectedProjectId` 置空、清空 `sessionStore`，避免显示已失效的会话面板

### 4.5 i18n（`apps/web/src/i18n`）

新增键（中英双语）：

- `rename.title` / `rename.label` / `rename.placeholder` / `rename.save`
- `delete.confirmTitle` / `delete.confirmMessage` / `delete.confirm`

## 5. 数据流

### 5.1 重命名

Sidebar 点击编辑图标 → 打开 RenameProjectDialog（预填 name）→ 用户改名 → Save → `projectStore.update(id, newName)` → `PUT /projects/:id` → 后端 update + 返回 → store 替换本地项 → Dialog 关闭 → 侧栏列表项 label 即时更新

### 5.2 删除

Sidebar 点击删除图标 → 打开 ConfirmDialog → 确认 → `projectStore.remove(id)` → `DELETE /projects/:id` → 后端：遍历 `sessionStates` 找该项目会话 → 逐个 kill agent + 清理 sessionStates → 软删 project（置 `deleted_at`）→ 204 → store 本地过滤 → 侧栏消失；若删的是当前选中项目，前端置空 `selectedProjectId` 并清空 `sessionStore`

## 6. 错误处理

- **重命名空名**：前端 Save 置灰 + 后端 `PUT` 400（双重防线）
- **重命名/删除不存在的项目**（已被软删或 id 错）：后端 `findById` 返回 null → 404；前端 store catch → toast 提示并刷新列表
- **删除时杀进程失败**：单个 session kill 失败记 warn 日志后继续，不阻断；最终必须软删 project，保证项目一定能从用户视角消失
- **网络错误**：store catch，toast 提示，本地状态回滚（重命名失败不更新本地，删除失败不过滤本地）

## 7. 测试

### 7.1 后端

- **Repo 单元**：`list()` 过滤软删项；`update(id, { name })` 只改 name 与 updated_at；`delete(id)` 置 `deleted_at` 而非硬删
- **路由**：`PUT /:id` 校验 + 200/404/400；`DELETE /:id` 软删 + 杀进程 + 204；删除带活跃会话的项目后 `sessionStates` 不再含该项目会话
- **e2e smoke**：复用现有 e2e 框架补「创建 → 重命名 → 删除」端到端用例

### 7.2 前端

- **`Sidebar.vue`**：hover 显示 action 按钮；点击编辑打开 dialog；点击删除打开 confirm；`@click.stop` 不触发 select
- **`RenameProjectDialog`**：预填、聚焦选中文本、空名禁用 Save、emit `rename` / `close`
- **`ConfirmDialog`**：emit `confirm` / `close`，danger 样式
- **store**：`update` 替换项；`remove` 过滤项；失败时不改本地状态

## 8. 非目标

- 回收站 UI（列表页 / 恢复 / 彻底删除）—— 未来单独 spec
- 批量删除项目
- 删除项目时清理其文件索引缓存（若后续证明有泄漏再处理）
- `workdir` / `description` 可编辑
