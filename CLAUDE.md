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
