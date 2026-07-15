# pi-web-ui

[pi](https://github.com/earendil-works/pi)（pi-coding-agent）的 Web UI —— 让你通过浏览器使用 pi 的 coding agent 能力，无需在本地装终端。

后端用 Fastify 以子进程方式托管 pi-coding-agent（RPC over stdio），前端用 Vue 3 提供聊天、项目/会话管理、只读文件查看与技能管理。

设计文档见 [`docs/superpowers/specs/2026-07-03-pi-web-ui-design.md`](docs/superpowers/specs/2026-07-03-pi-web-ui-design.md)。

## 功能特性

- **实时聊天**：基于 WebSocket 的 agent 事件流，支持消息发送、中断与流式渲染（Markdown + 语法高亮）
- **多项目管理**：创建、重命名、删除项目，每个项目独立工作区
- **会话与历史**：会话列表、重命名、消息历史持久化（SQLite）
- **只读文件查看**：文件树浏览 + 多格式预览（文本高亮、Markdown、图片、PDF、Office 文档 docx/xlsx/pptx、音视频）
- **多 LLM Provider**：Google Gemini / OpenAI / Anthropic / OpenRouter，运行时可切换模型
- **技能（Skills）管理**：本地技能的创建、zip 导入、安装；内置技能商店搜索与安装
- **空闲回收**：空闲/挂起的 agent 子进程自动清理，节约资源

## 架构

```
┌─────────────────────────────────────────────────┐
│  Frontend (Vue 3 + Naive UI + Vite)              │
│  Pinia store · WebSocket client · REST client    │
└────────────────────┬────────────────────────────┘
                     │ WebSocket (/ws/agent) + REST /api
┌────────────────────▼────────────────────────────┐
│  Backend (Fastify + TypeScript)                  │
│  · REST API: 项目/会话/文件/模型/技能             │
│  · WS 处理器: agent 事件流                        │
│  · ProcessManager + RPC Bridge: WS ↔ pi stdio    │
│  · better-sqlite3: 元数据 + 会话索引                │
└────────────────────┬────────────────────────────┘
                     │ child_process.spawn
┌────────────────────▼────────────────────────────┐
│  pi-coding-agent (RPC 模式, stdio)                │
│  每个活跃 session 一个独立子进程                   │
└─────────────────────────────────────────────────┘
```

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | Vue 3 · Naive UI · Pinia · Vue Router · Vite · marked / highlight.js / DOMPurify |
| 后端 | Fastify · TypeScript · better-sqlite3 · pino · tsx |
| 共享 | `@pi-web-ui/shared` —— 跨端共享的 TypeScript 类型 |
| 构建/测试 | pnpm workspace · vitest |

## 快速开始

### 前置要求

- Node.js `>=20`
- pnpm `9.6.0`
- 至少一个 LLM Provider 的 API Key
- pi-coding-agent 可用（默认通过 `npx -y @earendil-works/pi-coding-agent --mode rpc` 拉起，可用环境变量覆盖）

### 安装与运行

```bash
pnpm install
cp .env.example .env   # 然后填入你的 API Key
pnpm dev
```

启动后：

- 前端开发服务器监听 `http://localhost:3000`（Vite）
- 后端监听 `http://127.0.0.1:8080`（Fastify）
- 前端已配置代理，`/api` 与 `/ws` 自动转发到后端，浏览器打开 `http://localhost:3000` 即可

### 配置

复制 `.env.example` 为 `.env` 并按需修改。关键项：

```bash
# 服务监听
PORT=8080
HOST=127.0.0.1
LOG_LEVEL=info

# LLM Provider（四选一，至少填一个 API Key）
PI_PROVIDER=google        # google | openai | anthropic | openrouter
PI_MODEL=                  # 留空使用 provider 默认模型
GOOGLE_API_KEY=

# Agent 进程（可选，覆盖默认的 pi 启动命令）
# PI_COMMAND=npx
# PI_ARGS=-y @earendil-works/pi-coding-agent --mode rpc

# 超时（可选）
# IDLE_TIMEOUT_MS=300000        # 空闲多久后标记 idle
# SUSPENDED_TIMEOUT_MS=1800000 # 挂起多久后回收子进程
# NO_RESPONSE_TIMEOUT_MS=30000
```

数据目录默认在 `~/.pi-web-ui`（数据库 `pi-web-ui.sqlite`、日志 `logs/server.log`），可用 `PI_WEB_UI_ROOT` 覆盖。

## 常用脚本

在仓库根目录：

| 命令 | 说明 |
|---|---|
| `pnpm dev` | 并行启动所有 workspace 的 dev 模式 |
| `pnpm build` | 构建所有 workspace |
| `pnpm test` | 运行所有 workspace 的测试（vitest） |
| `pnpm typecheck` | 全仓 TypeScript 类型检查 |
| `pnpm lint` | 运行 lint（按各 workspace 配置） |

## 仓库结构

```
pi-web-ui/
├── apps/
│   ├── web/                 # Vue 3 前端
│   │   └── src/
│   │       ├── components/  # ChatPanel / Sidebar / FileTree / FileViewer / SkillStoreView ...
│   │       ├── stores/      # agent / connection / project / session (Pinia)
│   │       ├── api/         # REST client + WebSocket client
│   │       └── i18n/        # 多语言文案
│   ├── server/              # Fastify 后端
│   │   └── src/
│   │       ├── agent/       # 进程管理 / RPC bridge / 会话状态 / 空闲回收 / 技能
│   │       ├── db/          # SQLite + migrations + repositories
│   │       ├── routes/      # REST: projects / sessions / files / fs / config / models / skills / skill-store
│   │       ├── skill-store/ # 技能市场服务
│   │       └── ws/          # WebSocket agent 处理器
├── packages/
│   └── shared/              # 跨端共享的 TypeScript 类型
└── docs/
    └── superpowers/        # specs（设计）与 plans（实施计划）
```

## 文档

- 设计总览：[`docs/superpowers/specs/2026-07-03-pi-web-ui-design.md`](docs/superpowers/specs/2026-07-03-pi-web-ui-design.md)
- 项目增删改设计：[`docs/superpowers/specs/2026-07-09-project-edit-delete-design.md`](docs/superpowers/specs/2026-07-09-project-edit-delete-design.md)
- 聊天技能设计：[`docs/superpowers/specs/2026-07-10-chat-skills-design.md`](docs/superpowers/specs/2026-07-10-chat-skills-design.md)

实施计划见 [`docs/superpowers/plans/`](docs/superpowers/plans)。
