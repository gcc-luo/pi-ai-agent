# 对话框技能选择 — 设计文档

- 日期：2026-07-10
- 范围：在 pi-web-ui 的对话输入框添加技能下拉按钮，支持导入/卸载技能，选中后填入输入框调用 pi-coding-agent 的技能机制
- 状态：已确认，待实现

## 1. 背景与现状

pi-web-ui 当前通过 spawn `npx -y @earendil-works/pi-coding-agent --mode rpc` 子进程、用 JSONL RPC 协议与 pi-coding-agent 通信。web UI 仓库内**没有任何现有 skill/tool/slash-command 基础设施**。

pi-coding-agent 自身有完整的技能机制（见 `docs/skills.md` + `docs/rpc.md`）：

- 技能 = 目录 + `SKILL.md`（frontmatter `name` + `description` + 正文），可含 scripts/references/assets
- 技能目录：`~/.pi/agent/skills/`、`~/.agents/skills/`、项目 `.pi/skills/`、包内 `skills/`、settings 数组、`--skill` CLI 标志
- **调用**：发 `prompt` RPC 命令，message 内容为 `/skill:<name> [args]`，pi 在发送前自动展开。**这意味着 web UI 现有的 `send` → `prompt` 通道已足够，无需改 RPC bridge。**
- pi 也提供 `get_commands` RPC 列出所有可用技能，但它是请求-响应型（需要 `id` 关联），现有 bridge 没有这层；且 agent 进程是在首条消息时才 spawn 的，会话开始前 `get_commands` 拿不到结果。

## 2. 决策

| 维度 | 决策 | 理由 |
|------|------|------|
| 技能来源 | 只扫 `~/.pi/agent/skills/`（用户级）| 用户明确要求"全部都是用户级"；会话开始前可扫描；最简单；用户其他位置（`~/.agents/skills/`、项目 `.pi/skills/`、`--skill` 标志）的技能仍可手敲 `/skill:<name>` 调用，只是不在下拉里 |
| 技能形态 | 只支持目录型（`<name>/SKILL.md`）| 与导入表单结构一致；支持后续的 scripts/references/assets；根目录单文件 `.md` 技能不列出（pi 仍会发现并响应 `/skill:<name>`） |
| 选中行为 | 填入输入框可编辑后发送 | 用户已确认；与 pi 的 `/skill:<name> [args]` 语法一致，最灵活；不会误触 |
| 调用通道 | 现有 `send` → `prompt` RPC | 内容填 `/skill:<name> args...`，pi 自动展开；零侵入 |
| 卸载范围 | 全部可卸载 | 只有一个目录来源，无 location 区分；服务端做路径穿越防护 |
| 导入方式 | 内联对话框（name + description + body）| 镜像 NewProjectDialog 模式，最简、自包含；文件上传放第二期 |
| 导入冲突语义 | 覆盖（upsert）| 同名再导入即"编辑"；不报错，toast 提示已覆盖 |

## 3. 后端改动

### 3.1 配置 `apps/server/src/config.ts`

新增 `skillsDir: string`，默认 `path.join(os.homedir(), ".pi/agent/skills")`。不读环境变量，固定用 pi 标准用户级目录。

### 3.2 SkillService（新文件 `apps/server/src/agent/skill-service.ts`）

纯 fs 操作，不进 DB。

- `list(): Promise<SkillDto[]>`
  - 扫 `skillsDir` 下的直接子目录，过滤出含 `SKILL.md` 的
  - 对每个 `SKILL.md`：解析 YAML frontmatter，取 `name` 与 `description`
  - 缺 `description` 的跳过（与 pi 行为一致：pi 不加载无 description 的技能）
  - `path` 字段记录 `SKILL.md` 绝对路径
  - 目录扫描失败（权限/不存在）：返回空数组，warn 日志，不抛
  - 排序：按 name 字母升序

- `import({ name, description, body }): Promise<SkillDto>`
  - 校验 name：`/^[a-z0-9]+(-[a-z0-9]+)*$/`，长度 1-64，无前导/尾随/连续连字符（与 pi 名称规则一致）
  - 校验 description：非空字符串，长度 ≤ 1024
  - 目标目录：`skillsDir/<name>/`
  - 写入 `SKILL.md`：
    ```
    ---
    name: <name>
    description: <description>
    ---

    <body>
    ```
  - 已存在则覆盖（upsert 语义）
  - 写入后重新读取 frontmatter 返回 SkillDto

- `uninstall(name: string): Promise<void>`
  - 校验 name 格式（同 import）
  - 目标路径：`path.join(skillsDir, name)`
  - **路径穿越防护**：`path.resolve(target).startsWith(skillsDir + path.sep)` 必须为真，否则抛
  - 不存在：抛 `not found`（路由转 404）
  - `fs.rmSync(target, { recursive: true, force: true })`

### 3.3 路由（新文件 `apps/server/src/routes/skills.ts`）

- `GET /api/skills` → `skillService.list()` → `SkillDto[]`
- `POST /api/skills` body `{ name, description, body }` → 校验失败 400；成功 201 + SkillDto
- `DELETE /api/skills/:name` → 不存在 404；路径越界 400；成功 204

注册到 `apps/server/src/wiring.ts`，prefix `/api/skills`。

### 3.4 类型 `packages/shared/src/types.ts`

```ts
export interface SkillDto {
  name: string;
  description: string;
  path: string;  // SKILL.md 绝对路径，仅用于调试；前端不展示完整路径
}
```

## 4. 前端改动

### 4.1 `api/client.ts`

```ts
listSkills: () => request<SkillDto[]>("GET", "/skills"),
importSkill: (data: { name: string; description: string; body: string }) =>
  request<SkillDto>("POST", "/skills", data),
deleteSkill: (name: string) => request<void>("DELETE", `/skills/${encodeURIComponent(name)}`),
```

### 4.2 `SkillSelect.vue`（新组件，放在 ChatPanel composer 里）

- 触发器：小按钮，icon + "技能" 文字 + chevron
- 下拉面板：
  - 顶部：技能列表（name + 描述截断到 1 行）；空列表显示"暂无技能，点下方导入"
  - 列表项右侧 hover 出现卸载图标按钮（垃圾桶，`@click.stop`）
  - 底部：分隔线 + "导入新技能"按钮
- 选中技能 → emit `select(skillName)`
- 卸载 → 弹 ConfirmDialog → 调 `api.deleteSkill` → 刷新列表
- 导入 → emit `import` → 父组件打开 ImportSkillDialog
- 打开时（dropdown visible）自动 `api.listSkills()` 刷新一次，保证看到最新

### 4.3 `ImportSkillDialog.vue`（新组件）

镜像 NewProjectDialog 结构。字段：
- 名称：单行 NInput，校验 `/^[a-z0-9]+(-[a-z0-9]+)*$/`，违规时禁用 Save 并显示提示
- 描述：单行 NInput，非空才允许 Save
- 正文：多行 NInput textarea，非空才允许 Save
- Save → emit `create({ name, description, body })` → 父组件调 `api.importSkill` → 成功后关闭 + 刷新 SkillSelect 列表

### 4.4 `ChatPanel.vue` 改动

composer 行布局：`[textarea] [SkillSelect] [send button]`。
- textarea `flex: 1`
- SkillSelect 紧贴 textarea 右侧
- send 按钮保持最右

`SkillSelect @select(skillName)`：
- 取当前 `input.value`
- 如果非空且末尾不是空格/换行：追加一个空格
- 追加 `/skill:<skillName> `（末尾带空格，方便用户继续输入参数）
- focus textarea，光标定位到 value 末尾

`SkillSelect @import` → 打开 ImportSkillDialog。
ImportSkillDialog `@create` → `api.importSkill` → 关闭 + 刷新 SkillSelect。

### 4.5 i18n（`apps/web/src/i18n/messages.ts`）

新增键（中英双语）：

| 键 | en | zh |
|----|----|----|
| `skill.title` | Skills | 技能 |
| `skill.empty` | No skills yet — import one below | 暂无技能，点下方导入 |
| `skill.import` | Import skill | 导入技能 |
| `skill.uninstall` | Uninstall | 卸载 |
| `skill.confirmTitle` | Uninstall skill | 卸载技能 |
| `skill.confirmMessage` | Uninstall this skill? This cannot be undone. | 确认卸载该技能？此操作不可撤销。 |
| `skill.confirm` | Uninstall | 卸载 |
| `skill.cancel` | Cancel | 取消 |
| `skill.name` | Name | 名称 |
| `skill.namePlaceholder` | e.g. pdf-tools | 例如 pdf-tools |
| `skill.nameHint` | Lowercase letters, digits, hyphens. No leading/trailing/consecutive hyphens. | 小写字母、数字、连字符。不能以连字符开头/结尾或连续。 |
| `skill.description` | Description | 描述 |
| `skill.descriptionPlaceholder` | What this skill does and when to use it | 这个技能做什么、何时使用 |
| `skill.body` | Body (Markdown) | 正文（Markdown）|
| `skill.bodyPlaceholder` | Skill instructions in Markdown... | 用 Markdown 写技能指令... |
| `skill.save` | Save | 保存 |
| `skill.imported` | Skill imported | 技能已导入 |
| `skill.uninstalled` | Skill uninstalled | 技能已卸载 |

## 5. 数据流

### 5.1 列出技能

ChatPanel mount → `api.listSkills()` → `GET /api/skills` → SkillService.list() → 扫 `~/.pi/agent/skills/*/SKILL.md` → 解析 frontmatter → 返回 SkillDto[] → SkillSelect 下拉渲染

### 5.2 选中调用

用户点下拉项 → ChatPanel 把 `/skill:<name> ` 追加到 textarea → 用户可加参数 → 按发送 → `agent.send(sessionId, content)` → WS `send` 事件 → RpcBridge → pi `prompt` RPC `{ message: "/skill:<name> args..." }` → pi 自动展开 + 执行技能 → 消息流原路返回

### 5.3 导入

SkillSelect 下拉底部"导入技能" → 打开 ImportSkillDialog → 填 name/description/body → Save → `api.importSkill` → `POST /api/skills` → SkillService.import() → 写 `~/.pi/agent/skills/<name>/SKILL.md` → 返回 SkillDto → 关闭 dialog + 刷新 SkillSelect 列表 + toast "已导入"

### 5.4 卸载

技能项 hover 出现垃圾桶 → 点击 → ConfirmDialog → 确认 → `api.deleteSkill(name)` → `DELETE /api/skills/:name` → SkillService.uninstall() → 路径校验 + `fs.rmSync` → 204 → 刷新列表 + toast "已卸载"

## 6. 错误处理

- **导入 name 不合法**：前端 Save 禁用 + 后端 400 双重防线
- **导入 description 为空**：前端 Save 禁用 + 后端 400
- **导入同名覆盖**：upsert 不报错；前端 toast "已导入"（不区分新建/覆盖）
- **卸载路径越界**：服务端校验 `path.resolve(target)` 必须以 `skillsDir + path.sep` 开头，否则 400 拒绝
- **卸载不存在的技能**：服务端 404；前端 store catch → toast 提示并刷新列表
- **目录扫描失败**（权限等）：SkillService 返回空数组，warn 日志，不阻断；前端只看到空列表
- **网络错误**：前端 store catch，toast 提示，本地状态不变
- **选中技能后用户不加参数直接发送**：合法，pi 文档说 `/skill:name` 不带参数也能加载执行

## 7. 测试

### 7.1 后端

- **SkillService 单元**（在 tmpdir 构造 `~/.pi/agent/skills/`-like 结构）：
  - list：扫多个子目录 + 跳过无 SKILL.md 的 + 跳过缺 description 的 + frontmatter 解析正确 + 按名称排序
  - import：合法 name 写入 + name 校验失败抛 + description 为空抛 + 覆盖语义
  - uninstall：删除目录 + 路径穿越防护（`../escape` 抛）+ 不存在抛
- **路由集成**：GET 200 返列表；POST 201 / 400；DELETE 204 / 404 / 400（路径越界）

### 7.2 前端

- **SkillSelect**：渲染列表 + 空列表显示提示 + 选中 emit `select(name)` + 卸载按钮 emit 事件 + 导入按钮 emit 事件
- **ImportSkillDialog**：prefill、name 校验动态禁用 Save、description 空 禁用 Save、body 空 禁用 Save、save emit `create`
- **ChatPanel**：选中技能后 textarea 内容正确插入（空情况 + 已有内容情况）

## 8. 非目标

- 文件上传式导入（拾取 .md 文件）—— 第二期
- 从 git/URL 安装技能 —— 不做
- 编辑现有技能（导入即覆盖等价于编辑，不另做编辑入口）
- 项目级 `.pi/skills/` 扫描或写入 —— 用户明确要求不区分
- 共享 `~/.agents/skills/` 扫描 —— 不扫
- `--skill` CLI 标志加载的技能 —— 不扫
- 调用技能的"立即发送"模式 —— 用户已选填入输入框
- 根目录单文件 `.md` 技能列出 —— 仅目录型
- 调用 pi 的 `get_commands` RPC —— 直接服务端扫目录即可
