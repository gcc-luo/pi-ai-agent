# pi-web-ui 设计文档

**日期**: 2026-07-03
**状态**: 待用户审阅
**目标**: 为 pi 生态构建一个面向最终用户的 Web UI（产品化方向），MVP 阶段专注核心交互闭环。

## 1. 背景与目标

### 1.1 背景

- [pi](https://pi.dev/)（[GitHub](https://github.com/earendil-works/pi)）是 Earendil Inc. 维护的开源 AI coding agent 框架（MIT），核心包含 `pi-ai`（统一多 provider LLM API）、`pi-agent-core`（agent runtime）、`pi-coding-agent`（交互式 CLI）、`pi-tui`（终端 UI 库）。
- pi 提供三种使用方式：交互式 TUI、`-p` print/JSON 模式、RPC（JSON over stdio）、SDK 嵌入。
- pi 的设计哲学是"原语而非功能"，鼓励通过 extensions 扩展能力。

### 1.2 目标

构建 `pi-web-ui`：

- 给**最终用户**使用的 coding agent 产品形态（to C 方向）
- 通过 Web 浏览器使用 pi-coding-agent 能力，无需本地装终端
- MVP 范围：聊天交互、文件/项目管理（只读+diff）、会话历史管理
- 优先保证对 pi-coding-agent 的良好支持（RPC 模式集成）

### 1.3 非目标（MVP 不做）

- 用户账号系统 / 多租户
- 在线编辑代码（前端用本地 IDE 或 agent 操作）
- MCP、子 agent、plan mode 等高级特性（通过 pi 扩展加，不在 MVP）
- 横向扩展、集群部署
- 移动端适配

## 2. 架构

### 2.1 整体视图

```
┌─────────────────────────────────────────────────┐
│  Frontend (Vue 3 + Naive UI + Vite)              │
│  Pinia store · WebSocket client · REST client    │
└────────────────────┬────────────────────────────┘
                     │ WebSocket (/ws/agent) + REST
┌────────────────────▼────────────────────────────┐
│  Backend (Fastify + TypeScript)                  │
│  · REST API: 项目/会话/文件元数据                 │
│  · WS 处理器: agent 事件流                        │
│  · Session Manager: 子进程监督                     │
│  · RPC Bridge: WS ↔ pi stdio                    │
│  · better-sqlite3: 元数据 + 会话索引                │
└────────────────────┬────────────────────────────┘
                     │ child_process.spawn
┌────────────────────▼────────────────────────────┐
│  pi-coding-agent (RPC 模式, stdio)                │
│  每个活跃 session 一个独立子进程                   │
└─────────────────────────────────────────────────┘
```

### 2.2 核心数据流

#### 2.2.1 一次聊天消息

1. 用户在 ChatPanel 输入消息
2. 前端 Pinia store 通过 WebSocket 发 `agent.sendMessage` 事件
3. 后端 WS handler 找到该 session 对应的 pi 子进程
4. 把消息以 JSON-RPC 写入子进程 stdin
5. pi-coding-agent 处理，事件流到 stdout
6. RPC Bridge 解析 stdout 每行 JSON，转发给前端的 WebSocket
7. 前端 Pinia 更新状态，组件重渲染

#### 2.2.2 只读文件查看

用户点击文件树节点 → 前端调 REST `GET /api/files/:projectId/read?path=...` → 后端读盘 → 返回内容 + 语法高亮所需 metadata。

### 2.3 WebSocket 协议

#### 前端 → 后端

```ts
type ClientEvent =
  | { type: 'send';        sessionId: string; content: string }
  | { type: 'interrupt';   sessionId: string }
  | { type: 'steer';       sessionId: string; content: string }
  | { type: 'switchModel'; sessionId: string; model: string }
  | { type: 'ping' };
```

#### 后端 → 前端

```ts
type ServerEvent =
  | { type: 'message_start';  sessionId: string; messageId: string; role: 'user' | 'assistant' }
  | { type: 'message_delta';  sessionId: string; messageId: string; delta: string }
  | { type: 'message_end';    sessionId: string; messageId: string; content: string; metadata?: object }
  | { type: 'tool_call';      sessionId: string; messageId: string; name: string; args: object; toolCallId: string }
  | { type: 'tool_result';    sessionId: string; toolCallId: string; result: object }
  | { type: 'session_status'; sessionId: string; status: 'active' | 'idle' | 'suspended' | 'crashed' }
  | { type: 'error';          sessionId?: string; code: string; message: string }
  | { type: 'pong' };
```

## 3. 模块划分

### 3.1 Monorepo 布局

```
pi-web-ui/
├── package.json (workspace root)
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── apps/
│   ├── web/                    # Vue 3 前端
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── App.vue
│   │   │   ├── router/
│   │   │   ├── stores/         # Pinia
│   │   │   │   ├── project.ts
│   │   │   │   ├── session.ts
│   │   │   │   └── agent.ts    # 实时 agent 状态
│   │   │   ├── api/
│   │   │   │   ├── client.ts   # REST
│   │   │   │   └── ws.ts       # WebSocket
│   │   │   ├── views/
│   │   │   │   ├── Home.vue    # 项目列表
│   │   │   │   └── Project.vue # 项目详情
│   │   │   └── components/
│   │   │       ├── ChatPanel.vue
│   │   │       ├── FileTree.vue
│   │   │       ├── FileViewer.vue
│   │   │       ├── DiffViewer.vue
│   │   │       └── SessionTree.vue  # tree session
│   │   └── package.json
│   └── server/                 # Fastify 后端
│       ├── src/
│       │   ├── index.ts        # 入口
│       │   ├── app.ts          # Fastify 实例
│       │   ├── config.ts
│       │   ├── db/
│       │   │   ├── sqlite.ts
│       │   │   └── migrations.ts
│       │   ├── routes/
│       │   │   ├── projects.ts
│       │   │   ├── sessions.ts
│       │   │   └── files.ts
│       │   ├── ws/
│       │   │   └── agent.ts    # WS 处理器
│       │   ├── agent/
│       │   │   ├── process-manager.ts   # 进程监督
│       │   │   ├── rpc-bridge.ts        # stdio ↔ WS
│       │   │   └── session-state.ts     # 内存中的会话状态
│       │   └── workdir/
│       │       └── manager.ts           # 项目工作目录
│       └── package.json
└── packages/
    └── shared/                 # 前后端共享 TS 类型
        ├── src/types.ts        # WS 消息、REST DTO
        └── package.json
```

### 3.2 关键模块职责

- **`process-manager.ts`**：管理所有 pi-coding-agent 子进程的生命周期。提供 `start(sessionId, projectPath)`、`get(sessionId)`、`stop(sessionId)`。空闲超时自动停止以释放资源（具体阈值见 4.5：5 分钟无活动进入 idle，30 分钟无活动进入 suspended 并 kill 进程）。
- **`rpc-bridge.ts`**：单个 session 的双向桥，监听子进程 stdout 行（JSON-RPC），写入 stdin。维护 `Promise`-based 请求/响应关联（消息→响应 ID），把 streaming 事件直接转发。
- **`session-state.ts`**：内存中的活跃会话状态（process 句柄、消息缓冲、最近一次活动时间）。进程崩溃时持久化最后一次会话状态到 SQLite。
- **`agent store`（前端）**：维护实时流式消息（按 sessionId 索引），与后端 WS 事件同步。
- **`session store`（前端）**：管会话元数据/列表。
- **`project store`（前端）**：管项目列表。
- **`workdir/manager.ts`**：项目工作目录管理。创建项目时分配路径（默认 `~/.pi-web-ui/projects/<projectId>/`），写入 `.gitignore`，可选初始化 git 仓库。

## 4. 数据模型 & 持久化

### 4.1 SQLite Schema

```sql
-- 项目
CREATE TABLE projects (
  id           TEXT PRIMARY KEY,        -- ulid
  name         TEXT NOT NULL,
  workdir      TEXT NOT NULL UNIQUE,    -- 后端管理的绝对路径
  description  TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

-- 会话（支持 pi 的 tree session 结构）
CREATE TABLE sessions (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title           TEXT,                 -- 来自首次消息或用户改名
  parent_id       TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'active',  -- active | idle | suspended | crashed
  pi_session_ref  TEXT,                 -- pi 内部的 session id（用于恢复）
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  last_active_at  INTEGER
);
CREATE INDEX idx_sessions_project ON sessions(project_id);
CREATE INDEX idx_sessions_parent  ON sessions(parent_id);

-- 消息存档
CREATE TABLE messages (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role        TEXT NOT NULL,            -- user | assistant | tool
  content     TEXT,                     -- 文本内容；tool 调用的 JSON
  metadata    TEXT,                     -- JSON：tool 名、tokens、model 等
  created_at  INTEGER NOT NULL,
  seq         INTEGER NOT NULL          -- session 内序号
);
CREATE INDEX idx_messages_session_seq ON messages(session_id, seq);
```

### 4.2 工作目录布局

默认根目录 `~/.pi-web-ui/projects/<projectId>/`：

```
<workdir>/
├── .pi-web/                  # pi-web-ui 自己的元数据（gitignored）
│   └── config.json           # 项目级 agent 配置（可选）
├── AGENTS.md                 # pi 项目级 system prompt（用户可编辑）
├── SYSTEM.md
└── ...用户项目文件...
```

### 4.3 消息存档策略

- 流式消息（delta）只存在前端 agent store（Pinia 内存），不写盘
- 完整消息（`message_end` 时）批量写入 messages 表
- session 关闭（空闲超时 / 显式 stop）时，把所有未持久化的消息落盘
- 进程崩溃时，从子进程 stdout 缓冲抢救能抢救的

### 4.4 跨重启恢复

- 启动时：SQLite 读取所有 `status='active'` 的 sessions，标记为 `crashed`
- 用户的 `last_active_at` 之前的消息存档已存在
- 不自动重启 pi 进程——用户点 "resume" 时再起新进程 + 用 `pi_session_ref` 恢复上下文

### 4.5 Agent 进程状态机

| 状态 | 触发 | 动作 |
|------|------|------|
| `active` | 用户发消息 | 进程在跑，正常 |
| `idle` | 5 分钟无活动 | 进程保留，UI 标记 |
| `suspended` | 30 分钟无活动 | 进程 kill，下次 resume 重启 |
| `crashed` | 异常退出 | 标记，UI 提示，用户手动恢复 |

## 5. 错误处理

| 错误类型 | 检测位置 | 用户感知 | 恢复策略 |
|---------|---------|---------|---------|
| pi 子进程崩溃 | `process.on('exit', code !== 0)` | chat 顶部红色 banner "agent 崩溃" + 重试按钮 | 后端清理 process 句柄、抢救 stdout 缓冲中已收消息；前端 store 保留消息流；用户点重试则重启进程并喂入未发送消息 |
| pi 进程超时无响应 | 消息 send 后 30s 无任何 stdout | 提示 "agent 无响应"，可中断 | 前端发 `interrupt` 事件；后端 SIGTERM 进程 |
| WebSocket 断开 | 浏览器 `close` 事件 | 顶部黄色 banner "连接断开，正在重连" | 指数退避重连（1s, 2s, 4s, 8s, max 30s）；重连后从 SQLite 拉 session 状态同步到 agent store |
| API 调用失败 | HTTP 4xx/5xx | Naive UI `useMessage` 错误提示 | 表单回填可恢复；后端错误日志记录 |
| 文件读取失败 | 后端 `fs` 抛错 | FileViewer 显示 "无法读取" + 原因 | 不影响其他面板 |
| 项目工作目录丢失 | 创建项目后目录被外部删除 | 项目列表标 "missing" | 提示用户重新挂载或删除项目记录 |
| pi RPC 协议错误 | JSON parse 失败 / 未知消息类型 | 后端日志 + 忽略该消息 | 不影响后续消息；前端无感知 |

### 5.1 前端错误边界

- 全局 `app.config.errorHandler` 兜底未捕获异常
- Pinia store 不抛错，方法返回 `Result<T, E>` 风格的 `{ok, data, error}`
- WebSocket 心跳：每 25s 发 ping，60s 没回则视作断线

## 6. 测试策略

| 层 | 工具 | 覆盖范围 |
|----|------|---------|
| 单元 | Vitest | `rpc-bridge`（用 mock child_process）、`process-manager`、`session-state`、Pinia stores、纯函数（diff 解析、文件树构建） |
| 集成 | Vitest + supertest | REST 端点（projects/sessions/files CRUD）、WS 端点（mock 进程）、DB migrations |
| 端到端 | Playwright | 创建项目→开 session→发消息→看到流式回复→查看文件→恢复崩溃 session |
| 契约 | 自写 fixtures | 录制真实 pi RPC 流量作为 fixture，bridge 解析用 fixture 跑回归 |

### 6.1 调试友好性

- 后端 `pino` 日志带 requestId、sessionId 关联
- 前端 dev mode 下 Pinia store 改动在 Vue DevTools 可见
- WS 流量用 `wscat` 或类似工具可手工发
- 提供 `pnpm dev:debug` 用 `--inspect` 启动后端

## 7. 实施路线图（MVP 拆解）

实现阶段不写在此文档中，由 writing-plans 技能生成。MVP 大致阶段：

1. **骨架**：monorepo 脚手架、CI、最小前后端 hello world、WebSocket 握手
2. **进程层**：`process-manager` + `rpc-bridge` + 用 mock pi 跑通通信
3. **持久层**：SQLite schema、migrations、projects/sessions REST
4. **会话流**：session 增删、前端 ChatPanel 接入、消息流式展示
5. **文件层**：文件树、文件查看、diff 展示
6. **韧性**：崩溃恢复、断线重连、超时处理
7. **打磨**：tree session 可视化、tree session 创建/切换、AGENTS.md 编辑器

## 8. 待定项 / 风险

- **pi-coding-agent RPC 协议细节**：本文档基于公开信息（pi.dev 介绍 + GitHub 描述），具体的 RPC 消息 schema 需要在实现阶段通过 `pi --help` / 源码确认。如果 RPC 接口与本文档描述有出入，需相应调整 `rpc-bridge.ts`。
- **pi session 持久化格式**：pi 是否暴露 session 导入/导出命令？需要验证；如不支持，则 tree session 跨重启恢复需要我们自行实现。
- **pi 扩展机制**：MVP 不直接用 pi 扩展，但后续可能需要通过扩展注入自定义能力。需要评估 pi 扩展 SDK 是否支持浏览器/Web 场景。
- **pi-tui vs Web UI 的特性差距**：pi-tui 有 differential rendering、键盘快捷键等，Web UI 需要一一映射；某些 TUI 专有功能可能在 Web 端不适用。
