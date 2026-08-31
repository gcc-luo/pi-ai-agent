# CLAUDE.md

本文件为 Claude Code 在本仓库工作时提供指引。

## Git 提交规范（中文 Conventional Commits）

本仓库使用 **Conventional Commits** 的中文适配版本。所有 commit message 必须遵循：

```
<type>(<scope>): <subject>

<body>
```

### type（必填，保留英文关键字）

| 类型 | 说明 |
| --- | --- |
| `feat` | 新功能 |
| `fix` | 修复缺陷 |
| `docs` | 文档变更 |
| `style` | 代码格式（不影响逻辑） |
| `refactor` | 重构（非新功能、非修复） |
| `perf` | 性能优化 |
| `test` | 测试相关 |
| `chore` | 构建/工具/依赖变更 |
| `ci` | 持续集成配置 |
| `revert` | 回滚提交 |

### scope（选填）

本项目是 pnpm monorepo，scope 用 **英文小写包名** 表示影响范围：

- `web` —— 前端（`apps/web`）
- `server` —— 后端（`apps/server`）
- `shared` —— 共享类型（`packages/shared`）
- 省略 —— 跨多包或顶层改动

示例：`feat(web): 新增 PPTX 文件预览组件`、`refactor(server): 移除会话状态圆点`

### subject（必填）

- 中文简述，**动宾短语**：`新增 xxx`、`修复 xxx`、`优化 xxx`、`重构 xxx`
- 不超过 50 个汉字
- **不加句号结尾**
- 不写「修改了代码」「更新代码」这类无意义描述

### body（选填）

- 说明**为什么**改（背景/原因）、**怎么做**（方案要点）、**影响范围**
- 与标题之间空一行
- 每行不超过 72 个字符（中文约 36 字）
- 多点说明用 `-` 列表

### 不兼容变更

涉及数据库表结构、公共 API 参数/返回值、配置文件格式等不兼容变更时，必须在 footer 标注并写明迁移方法：

```
feat(server)!: 重构会话消息返回结构

BREAKING CHANGE: /api/sessions/:id/messages 返回字段变更
- messages 数组项改嵌套结构
- 前端需同步调整取值路径
```

### 实际示例（取自本仓库历史）

```
feat: 新增技能商店，支持市场搜索与已安装技能管理
feat(web): 新增 PPTX 文件预览组件
feat(web): 文本预览按语言语法高亮，FileViewer 改为异步加载
refactor(web): 移除会话状态圆点
feat: 会话默认标题取首句内容并优化新建会话展示
```

### 提交前自查

- [ ] type 选取正确
- [ ] scope 准确（`web` / `server` / `shared` 或省略）
- [ ] subject 为动宾短语、无句号、≤50 字
- [ ] 一次提交只做一件事（原子性）
- [ ] 不兼容变更已标注 BREAKING CHANGE
- [ ] 中英文/数字之间加一个空格（如「升级 webpack 到 v5」）

### 备注

- Claude 在本仓库创建提交时，默认按本规范书写 commit message，中文描述 + 英文 type。
- 生成提交消息时末尾附 `Co-Authored-By: Claude <noreply@anthropic.com>`。
- **不要自动提交**：完成代码改动后不自动执行 `git commit`，需等用户明确指示后再提交并推送。

## 打 Tag 规范

**每次 commit 提交后必须自动触发 Tag 判断机制**。AI 需主动评估本次提交是否应该打 tag，若应打则立即执行打 tag 并推送，无需用户额外指示。

### 何时打 Tag

满足以下任一条件时，应在 commit 推送后打 tag：

- 提交类型为 `feat`（新功能）
- 提交类型为 `fix` 且修复了**面向用户的缺陷**
- 包含 `BREAKING CHANGE`（不兼容变更）
- 用户明确要求打 tag

**不打 Tag 的情况**：`docs`、`style`、`test`、`ci`、`chore`、`refactor`（非公开 API 变更）等内部改动不打 tag。

### 版本号格式

固定三位语义化版本：`vMAJOR.MINOR.PATCH`

**判断标准**：根据改动规模判断版本升级幅度
- **核心新功能**（引入面向用户的主要功能模块）→ `MINOR` +1，`PATCH` 归零
- **小幅增强/优化**（改进现有功能、添加辅助特性）→ `PATCH` +1
- `fix` 提交 → `PATCH` +1（如 `v1.2.0` → `v1.2.1`）
- `BREAKING CHANGE` → `MAJOR` +1，其余归零（如 `v1.2.0` → `v2.0.0`）

**示例**：
- 新增技能商店、新增回收站 → MINOR +1
- 侧边栏搜索、统一 toast 提示 → PATCH +1
- 修复 bug → PATCH +1

### 操作流程

1. 通过 `git tag --sort=-v:refname | head -1` 获取当前最新 tag
2. 按上述规则计算新版本号
3. 打带注释的 tag 并推送：

```bash
git tag -a v1.2.1 -m "v1.2.1: <简述本次变更>"
git push origin v1.2.1
```


### 打 Tag 前必须执行 release:prepare

**打任何版本 tag 之前，必须先运行 `pnpm release:prepare <版本号>`，禁止直接 `git tag`。**

该命令自动完成三件事，缺一不可：

1. 同步升级 `apps/desktop/package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 三处版本号（不跑会因版本不一致被 pre-push 钩子拦截）；
2. 若 `docs/release-notes/v<版本号>.md` 不存在，自动从上一个版本 tag 到 HEAD 的提交生成草稿文件；
3. 若文件已存在，则校验其内容不是未整理的原始草稿。

**AI 的职责**：当脚本生成了草稿（输出含 `ACTION REQUIRED`）时，必须先阅读草稿中的原始提交列表，按 [版本更新说明规范](docs/release-notes-standard.md) 将其改写为 `1、2、3` 编号列表（3～8 条用户可见变更，剔除 `docs`/`chore`/`ci`/`test` 等内部提交，合并同主题提交），然后才能继续。

完整打 tag 流程：

```bash
pnpm release:prepare 1.4.4        # 升版本号 + 生成/校验更新说明
# 若生成了草稿：改写 docs/release-notes/v1.4.4.md 为正式编号列表
git add -A && git commit -m "chore: 升级版本号到 v1.4.4"
git tag -a v1.4.4 -m "v1.4.4: <简述>" && git push origin release/v1.0 v1.4.4
```

### 备注

- tag 的 `-m` 消息格式为 `vX.Y.Z: <一句话中文简述>`
- 无需为 tag 单独创建 commit，tag 打在刚推送的那个 commit 上
