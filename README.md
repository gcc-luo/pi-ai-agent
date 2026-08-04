# pi-web-ui

[pi](https://github.com/earendil-works/pi)（pi-coding-agent）的 Web UI —— 让你通过浏览器使用 pi 的 coding agent 能力，无需在本地装终端。

后端用 Fastify 以子进程方式托管 pi-coding-agent（RPC over stdio），前端用 Vue 3 提供聊天、项目/会话管理、文件预览、知识库、技能、专家、定时任务、消息渠道等完整功能。

## 功能特性

### 核心对话

- **实时聊天**：基于 WebSocket 的 agent 事件流，支持消息发送、中断、引导（steer）与流式渲染
- **Markdown + 语法高亮**：marked + highlight.js + DOMPurify 安全渲染
- **多模态消息**：支持图片附件（最多 5 张，5MB/张）与文本文件上传（1MB）
- **思维链展示**：thinking_delta 事件可折叠展示
- **工具调用可视化**：tool_call / tool_progress / tool_result 事件，显示参数、结果与运行状态
- **Token 用量追踪**：每个会话累计 input/output token 统计
- **模型热切换**：运行时按会话切换 LLM 模型

### 项目与会话

- **多项目管理**：创建（目录浏览器）、重命名、删除项目，每个项目独立工作区
- **会话管理**：创建、重命名、删除会话，支持父子会话（线程化对话）
- **消息持久化**：完整消息历史存储于 SQLite
- **文件树**：项目目录浏览 + 文件创建/重命名/删除
- **回收站**：软删除项目和会话，支持恢复或永久删除

### 文件预览

支持 10+ 种文件格式预览：

| 类型 | 格式 |
|------|------|
| 文本/代码 | 语法高亮（所有文本格式） |
| 文档 | Markdown、PDF、DOCX、XLSX、PPTX |
| 旧版 Office | .doc / .xls / .ppt / .odt / .ods / .odp / .rtf（需 LibreOffice） |
| 媒体 | 图片（PNG/JPG/GIF/WebP）、音频、视频 |

### LLM 模型管理

- **多 Provider**：Google Gemini / OpenAI / Anthropic / OpenRouter
- **自定义模型**：添加/编辑/删除模型，配置 API Base URL、API Key、类型（文本/多模态/Embedding）
- **连接测试**：保存前测试模型连通性
- **默认模型**：标记默认模型用于新会话

### 知识库（RAG）

- **知识库 CRUD**：创建、管理知识库，支持绑定 Embedding 模型
- **文件导入**：批量导入 PDF / DOCX / TXT / MD 文件
- **解析流水线**：文档自动分块，支持页码边界
- **混合搜索**：FTS5 全文检索（jieba 中文分词）+ 向量相似度搜索
- **会话绑定**：将知识库绑定到会话，自动注入上下文
- **搜索引用卡片**：搜索结果在聊天中以引用卡片形式展示

### 技能（Skills）

- **本地技能**：创建、zip 导入、删除本地技能
- **技能商店**：从 skills.sh / SkillsMP / GitHub 搜索和安装技能
- **AI 搜索**：语义化技能搜索模式
- **技能预览**：安装前查看技能内容
- **安全审计**：展示 SkillsMP 安全审计状态

### 专家中心

- **23 个预设专家**：覆盖开发、设计、数据、营销、产品、财务、法务、运营 8 大类别
- **自定义专家**：创建自定义专家角色（名称、图标、类别、系统提示词、标签）
- **专家召唤**：召唤专家开启专属对话会话
- **系统提示词注入**：专家的系统提示词自动注入到 agent 消息中

### 定时任务

- **任务管理**：创建、编辑、删除定时任务
- **任务类型**：自动提问（prompt）、定时提醒（reminder）
- **Cron 调度**：5 字段 cron 表达式 + 快捷预设（每 5 分钟/每小时/每天 9 点/每周一/每月 1 号）
- **启用/禁用**：开关任务无需删除
- **手动触发**：立即执行任务
- **执行日志**：查看任务执行历史（成功/失败/运行中）

### 消息渠道

- **微信频道**：通过 @wechatbot/wechatbot SDK 集成个人微信
  - 扫码登录（QR 状态机：获取二维码 → 等待扫码 → 确认 → 登录）
  - 会话持久化，重启自动恢复登录
  - 按 wxid 路由到独立 Pi 会话
- **钉钉频道**：通过 Stream 协议集成钉钉智能机器人
  - Client ID / Secret / Robot Code 配置
  - 消息接收与自动回复
- **渠道配置管理**：创建、更新、删除、启用/禁用渠道配置
- **连通性测试**：发送测试消息验证配置

### 编码模式

- **CodingPanel**：独立编码工作区视图
- **TUI 终端面板**：嵌入式终端（WebSocket）
- **模式切换**：对话模式 / 编码模式自由切换
- **Artifact 卡片**：展示 agent 生成的代码/文件产物

### 通用

- **深色/浅色主题**：跟随系统偏好，可手动切换，持久化到 localStorage
- **中英文国际化**：运行时切换，持久化到 localStorage
- **连接状态指示**：WebSocket 连接状态实时显示（已连接/连接中/已断开）
- **空闲回收**：空闲 5 分钟标记 idle，挂起 30 分钟自动回收 agent 子进程

## 架构

```
┌──────────────────────────────────────────────────────┐
│  Frontend (Vue 3 + Naive UI + Vite + Pinia)          │
│  WebSocket client · REST client · 12 Pinia stores    │
└────────────────────────┬─────────────────────────────┘
                         │ WebSocket (/ws/agent, /ws/terminal)
                         │ REST (/api/*)
┌────────────────────────▼─────────────────────────────┐
│  Backend (Fastify + TypeScript)                       │
│  · REST API: 项目/会话/文件/模型/技能/知识库/          │
│              专家/定时任务/渠道/回收站                  │
│  · WS: agent 事件流 + 终端                            │
│  · ProcessManager + RPC Bridge: WS ↔ pi stdio        │
│  · TaskScheduler: croner 定时任务调度                  │
│  · Channel Registry: 微信/钉钉渠道适配器              │
│  · better-sqlite3: 14 张表 + FTS5 全文索引            │
└────────────────────────┬─────────────────────────────┘
                         │ child_process.spawn
┌────────────────────────▼─────────────────────────────┐
│  pi-coding-agent (RPC 模式, stdio)                    │
│  每个活跃 session 一个独立子进程                       │
└──────────────────────────────────────────────────────┘
```

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | Vue 3 · Naive UI · Pinia · Vite · marked / highlight.js / DOMPurify |
| 后端 | Fastify · TypeScript · better-sqlite3 · pino · tsx · croner |
| 共享 | `@pi-web-ui/shared` —— 跨端共享的 TypeScript 类型 |
| 渠道 | @wechatbot/wechatbot · @amaster.ai/pi-channels |
| 构建/测试 | pnpm workspace · vitest |

## 快速开始

### 前置要求

- Node.js `>=20`
- pnpm `9.6.0`
- 至少一个 LLM Provider 的 API Key
- pi-coding-agent 可用（默认通过 `npx -y @earendil-works/pi-coding-agent --mode rpc` 拉起）

### 安装与运行

```bash
pnpm install
cp .env.example .env   # 然后填入你的 API Key
pnpm start
```

启动后：

- `pnpm start` 会同时启动后端服务与桌面端；桌面端会自动启动共享的浏览器端 Vite 服务
- 前端开发服务器：`http://localhost:3000`（Vite）
- 后端 API 服务：`http://127.0.0.1:8080`（Fastify）
- 前端已配置代理，`/api` 与 `/ws` 自动转发到后端
- 浏览器打开 `http://localhost:3000` 即可使用

### 分开启动

如需分别调试某一端，可使用以下命令：

```bash
pnpm --dir apps/server dev    # 仅启动后端
pnpm --dir apps/web dev       # 仅启动浏览器端
pnpm --dir apps/desktop dev   # 启动桌面端，并自动启动浏览器端 Vite
```

桌面端开发通常只需要运行 `pnpm start`。不要同时运行独立的浏览器端命令，
否则可能与 Tauri 自动启动的 Vite 服务争用 `3000` 端口。

### 构建与打安装包

浏览器端和后端可以分别构建：

```bash
pnpm --dir apps/web build
pnpm --dir apps/server build
```

构建桌面端安装包前，需要先准备后端 sidecar。sidecar 会把后端打包成桌面端可携带的
独立可执行文件：

```bash
pnpm --dir apps/desktop prepare-sidecar
pnpm --dir apps/desktop build
```

`prepare-sidecar` 会自动重新构建后端，并使用 `pkg` 生成当前操作系统与 CPU 架构的
sidecar。首次执行时如果本地没有 `pkg`，脚本会通过 `npx` 获取。

桌面端安装包输出在：

```text
apps/desktop/src-tauri/target/release/bundle/
```

其中会按平台生成对应产物，例如 macOS 的 `.dmg` / `.app`、Windows 的 `.msi` / `.exe`
以及 Linux 的 `.deb` / `.AppImage`。如需生成调试版桌面包：

```bash
pnpm --dir apps/desktop build:debug
```

也可以使用以下命令构建所有 workspace；但桌面端打包前仍建议先执行
`prepare-sidecar`：

```bash
pnpm build
```

### 环境变量

复制 `.env.example` 为 `.env` 并按需修改：

```bash
# 服务监听
PORT=8080
HOST=127.0.0.1
LOG_LEVEL=info

# LLM Provider（四选一，至少填一个 API Key）
PI_PROVIDER=google        # google | openai | anthropic | openrouter
PI_MODEL=                  # 留空使用 provider 默认模型
PI_AUTO_COMPACTION=true    # 接近上下文上限时自动压缩，默认 true
GOOGLE_API_KEY=

# Agent 进程（可选，覆盖默认启动命令）
# PI_COMMAND=npx
# PI_ARGS=-y @earendil-works/pi-coding-agent --mode rpc
# PI_NPM_REGISTRY=https://registry.npmjs.org/

# 超时（可选）
# IDLE_TIMEOUT_MS=300000         # 空闲多久后标记 idle（5 分钟）
# SUSPENDED_TIMEOUT_MS=1800000   # 挂起多久后回收子进程（30 分钟）
# NO_RESPONSE_TIMEOUT_MS=30000

# 数据目录（可选）
# PI_WEB_UI_ROOT=                # 默认 ~/.pi-web-ui

# LibreOffice（可选，用于预览旧版 Office 文档）
# LIBREOFFICE_BINARY=
```

### 数据存储

数据目录默认 `~/.pi-web-ui`（可通过 `PI_WEB_UI_ROOT` 覆盖）：

| 文件 | 说明 |
|------|------|
| `pi-web-ui.sqlite` | SQLite 数据库（14 张表） |
| `logs/server.log` | 服务端日志 |
| `kb-files/` | 知识库上传的文件 |
| `wechat-session/` | 微信登录会话凭据 |

## 常用脚本

| 命令 | 说明 |
|---|---|
| `pnpm start` | 全量启动后端、桌面端和浏览器端开发服务 |
| `pnpm dev` | 并行执行各 workspace 的 `dev` 脚本 |
| `pnpm build` | 构建所有 workspace；桌面端打包前需先准备 sidecar |
| `pnpm --dir apps/desktop prepare-sidecar` | 生成当前平台的后端 sidecar |
| `pnpm --dir apps/desktop build` | 构建桌面端生产安装包 |
| `pnpm --dir apps/desktop build:debug` | 构建桌面端调试安装包 |
| `pnpm test` | 运行所有测试（vitest） |
| `pnpm typecheck` | 全仓 TypeScript 类型检查 |
| `pnpm lint` | 运行 lint |

## 仓库结构

```
pi-web-ui/
├── apps/
│   ├── web/                     # Vue 3 前端
│   │   └── src/
│   │       ├── components/      # 页面组件（ChatPanel / Sidebar / NavRail / ...）
│   │       ├── stores/          # Pinia stores（12 个）
│   │       ├── api/             # REST client + WebSocket client
│   │       ├── utils/           # 工具函数（markdown / cron / kb / skill-tips）
│   │       └── i18n/            # 中英文国际化
│   ├── server/                  # Fastify 后端
│   │   └── src/
│   │       ├── agent/           # 进程管理 / RPC bridge / 会话状态 / 空闲回收
│   │       ├── channels/        # 渠道集成（微信 / 钉钉）
│   │       ├── db/              # SQLite + migrations（14 张表）+ repositories
│   │       ├── kb/              # 知识库搜索 / 解析流水线 / FTS 分词
│   │       ├── routes/          # REST API 路由（16 个路由模块）
│   │       ├── services/        # 定时任务调度 / LibreOffice 转换
│   │       ├── skill-store/     # 技能市场服务
│   │       └── ws/              # WebSocket（agent + terminal）
├── packages/
│   └── shared/                  # 跨端共享 TypeScript 类型
└── patches/                     # 第三方包补丁
```

## 数据库表结构

| 表 | 说明 |
|---|---|
| `projects` | 项目（支持软删除） |
| `sessions` | 会话（父子线程 + 专家绑定 + 软删除） |
| `messages` | 消息历史（序列号排序） |
| `models` | LLM 模型配置 |
| `experts` | 专家角色（预设 + 自定义） |
| `knowledge_bases` | 知识库定义 |
| `kb_files` | 知识库文件（解析状态追踪） |
| `kb_chunks` | 文本分块 |
| `kb_chunks_fts` | FTS5 全文搜索索引 |
| `session_kb_bindings` | 会话 ↔ 知识库绑定 |
| `scheduled_tasks` | 定时任务定义 |
| `task_logs` | 任务执行日志 |
| `channels` | 渠道配置（微信/钉钉等） |
| `channel_conversations` | 渠道用户 ↔ 会话绑定 |
