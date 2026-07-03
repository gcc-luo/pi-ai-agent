# pi-web-ui MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Web UI for the pi-coding-agent that lets end users create projects, chat with the agent, browse files, and manage sessions through a browser.

**Architecture:** Monorepo with `apps/web` (Vue 3 + Naive UI + Vite) and `apps/server` (Fastify + TypeScript). Server spawns one pi-coding-agent subprocess per active session and bridges its stdio JSON-RPC to a WebSocket; metadata lives in SQLite. Frontend uses Pinia stores and streams agent events live.

**Tech Stack:** pnpm workspaces, TypeScript, Vue 3, Naive UI, Vite, Pinia, Vitest, Fastify, better-sqlite3, ulid, pino, @fastify/websocket, @fastify/cors

**Spec:** `docs/superpowers/specs/2026-07-03-pi-web-ui-design.md`

---

## File Structure

**Root**
- `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `.npmrc`, `README.md`

**`packages/shared/`** — WS/REST types shared by both apps
- `package.json`, `tsconfig.json`
- `src/types.ts` — `ClientEvent`, `ServerEvent`, REST DTOs
- `src/index.ts`

**`apps/server/`** — Fastify backend
- `package.json`, `tsconfig.json`, `vitest.config.ts`
- `src/index.ts`, `src/app.ts`, `src/config.ts`
- `src/db/sqlite.ts`, `src/db/migrations.ts`
- `src/db/repositories/{project,session,message}.ts`
- `src/routes/{projects,sessions,files}.ts`
- `src/ws/agent.ts`
- `src/agent/{process-manager,rpc-bridge,session-state,types}.ts`
- `src/workdir/manager.ts`
- `src/util/{result,ulid,logger,errors}.ts`
- `tests/setup.ts`, `tests/fixtures/mock-pi.ts`
- `tests/unit/{process-manager,rpc-bridge,session-state,workdir-manager}.test.ts`
- `tests/integration/{projects,sessions,files,ws}.test.ts`

**`apps/web/`** — Vue 3 frontend
- `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `index.html`
- `src/{main,App}.{ts,vue}`
- `src/router/index.ts`
- `src/stores/{project,session,agent,connection}.ts`
- `src/api/{client,ws}.ts`
- `src/views/{Home,Project}.vue`
- `src/components/{ChatPanel,FileTree,FileViewer,DiffViewer,SessionTree,StatusBanner,ProjectCard,SessionListItem,FileTreeNode}.vue`
- `src/types.ts` (re-exports shared)
- `tests/unit/{project-store,session-store,agent-store,connection-store,api-client,ws-client}.test.ts`

---

## Phase 0: Foundation

### Task 1: Initialize monorepo

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `.npmrc`, `README.md`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "pi-web-ui",
  "private": true,
  "version": "0.0.1",
  "scripts": {
    "dev": "pnpm -r --parallel run dev",
    "build": "pnpm -r run build",
    "test": "pnpm -r run test",
    "typecheck": "pnpm -r run typecheck",
    "lint": "pnpm -r run lint"
  },
  "devDependencies": {
    "typescript": "5.5.4",
    "prettier": "3.3.3",
    "@types/node": "20.14.10"
  },
  "packageManager": "pnpm@9.6.0",
  "engines": { "node": ">=20" }
}
```

- [ ] **Step 2: Write `pnpm-workspace.yaml`**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 3: Write `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true
  }
}
```

- [ ] **Step 4: Write `.gitignore`**

```
node_modules/
dist/
*.log
.superpowers/
.DS_Store
*.sqlite
*.sqlite-journal
.env
.env.local
```

- [ ] **Step 5: Write `.npmrc`**

```
save-exact=true
strict-peer-dependencies=false
```

- [ ] **Step 6: Write `README.md`**

```markdown
# pi-web-ui

Web UI for pi-coding-agent. See `docs/superpowers/specs/2026-07-03-pi-web-ui-design.md` for the design.

## Development

\`\`\`bash
pnpm install
pnpm dev
\`\`\`

## Layout

- `apps/web` — Vue 3 frontend
- `apps/server` — Fastify backend
- `packages/shared` — shared TypeScript types
```

- [ ] **Step 7: Initialize git and install**

```bash
cd /Users/gengcc/Documents/project/pi-web-ui
git init
git add -A
git commit -m "chore: initialize monorepo"
pnpm install
```

Expected: pnpm install completes without error.

### Task 2: Create shared types package

**Files:**
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/types.ts`, `packages/shared/src/index.ts`
- Test: `packages/shared/tests/types.test-d.ts`

- [ ] **Step 1: Write `packages/shared/package.json`**

```json
{
  "name": "@pi-web-ui/shared",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "echo 'no tests'"
  },
  "devDependencies": {
    "typescript": "5.5.4"
  }
}
```

- [ ] **Step 2: Write `packages/shared/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Write `packages/shared/src/types.ts`**

```ts
// WebSocket events: client → server
export type ClientEvent =
  | { type: "send"; sessionId: string; content: string }
  | { type: "interrupt"; sessionId: string }
  | { type: "steer"; sessionId: string; content: string }
  | { type: "switchModel"; sessionId: string; model: string }
  | { type: "ping" };

// WebSocket events: server → client
export type ServerEvent =
  | { type: "message_start"; sessionId: string; messageId: string; role: "user" | "assistant" }
  | { type: "message_delta"; sessionId: string; messageId: string; delta: string }
  | { type: "message_end"; sessionId: string; messageId: string; content: string; metadata?: Record<string, unknown> }
  | { type: "tool_call"; sessionId: string; messageId: string; name: string; args: unknown; toolCallId: string }
  | { type: "tool_result"; sessionId: string; toolCallId: string; result: unknown }
  | { type: "session_status"; sessionId: string; status: SessionStatus }
  | { type: "error"; sessionId?: string; code: string; message: string }
  | { type: "pong" };

export type SessionStatus = "active" | "idle" | "suspended" | "crashed";

// REST DTOs
export interface ProjectDto {
  id: string;
  name: string;
  workdir: string;
  description: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface SessionDto {
  id: string;
  projectId: string;
  title: string | null;
  parentId: string | null;
  status: SessionStatus;
  createdAt: number;
  updatedAt: number;
  lastActiveAt: number | null;
}

export interface MessageDto {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "tool";
  content: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: number;
  seq: number;
}

export interface FileNodeDto {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  children?: FileNodeDto[];
}

export interface FileContentDto {
  path: string;
  content: string;
  size: number;
  mtime: number;
}

export interface Result<T, E = string> {
  ok: boolean;
  data?: T;
  error?: E;
}
```

- [ ] **Step 4: Write `packages/shared/src/index.ts`**

```ts
export * from "./types.js";
```

- [ ] **Step 5: Install dependencies and verify**

```bash
cd /Users/gengcc/Documents/project/pi-web-ui
pnpm install
pnpm --filter @pi-web-ui/shared typecheck
```

Expected: typecheck passes.

- [ ] **Step 6: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): add shared types package"
```

### Task 3: Server app skeleton

**Files:**
- Create: `apps/server/package.json`, `apps/server/tsconfig.json`, `apps/server/vitest.config.ts`, `apps/server/src/index.ts`, `apps/server/src/app.ts`, `apps/server/src/config.ts`
- Test: `apps/server/tests/integration/hello.test.ts`

- [ ] **Step 1: Write `apps/server/package.json`**

```json
{
  "name": "@pi-web-ui/server",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@fastify/cors": "9.0.1",
    "@fastify/websocket": "10.0.1",
    "@pi-web-ui/shared": "workspace:*",
    "better-sqlite3": "11.1.2",
    "fastify": "4.28.1",
    "pino": "9.3.2",
    "pino-pretty": "11.2.2",
    "ulid": "2.3.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "7.6.11",
    "@types/node": "20.14.10",
    "tsx": "4.16.2",
    "typescript": "5.5.4",
    "vitest": "1.6.0"
  }
}
```

- [ ] **Step 2: Write `apps/server/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

- [ ] **Step 3: Write `apps/server/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    globals: false,
    environment: "node",
  },
});
```

- [ ] **Step 4: Write `apps/server/src/config.ts`**

```ts
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

export interface Config {
  port: number;
  host: string;
  workdirRoot: string;
  dbPath: string;
  logLevel: string;
  piCommand: string;
  idleTimeoutMs: number;
  suspendedTimeoutMs: number;
  noResponseTimeoutMs: number;
}

const defaultRoot = path.join(os.homedir(), ".pi-web-ui");

export function loadConfig(): Config {
  const root = process.env.PI_WEB_UI_ROOT ?? defaultRoot;
  fs.mkdirSync(root, { recursive: true });
  return {
    port: Number(process.env.PORT ?? 5174),
    host: process.env.HOST ?? "127.0.0.1",
    workdirRoot: path.join(root, "projects"),
    dbPath: path.join(root, "pi-web-ui.sqlite"),
    logLevel: process.env.LOG_LEVEL ?? "info",
    piCommand: process.env.PI_COMMAND ?? "npx -y @earendil-works/pi-coding-agent",
    idleTimeoutMs: Number(process.env.IDLE_TIMEOUT_MS ?? 5 * 60 * 1000),
    suspendedTimeoutMs: Number(process.env.SUSPENDED_TIMEOUT_MS ?? 30 * 60 * 1000),
    noResponseTimeoutMs: Number(process.env.NO_RESPONSE_TIMEOUT_MS ?? 30 * 1000),
  };
}
```

- [ ] **Step 5: Write `apps/server/src/app.ts`**

```ts
import Fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { Config } from "./config.js";

export async function buildApp(config: Config): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: config.logLevel, transport: { target: "pino-pretty" } },
  });

  await app.register(cors, { origin: true, credentials: true });
  await app.register(websocket);

  app.get("/healthz", async () => ({ ok: true }));

  return app;
}
```

- [ ] **Step 6: Write `apps/server/src/index.ts`**

```ts
import { loadConfig } from "./config.js";
import { buildApp } from "./app.js";

const config = loadConfig();
const app = await buildApp(config);

try {
  await app.listen({ port: config.port, host: config.host });
  app.log.info(`pi-web-ui server listening on http://${config.host}:${config.port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
```

- [ ] **Step 7: Write `apps/server/tests/integration/hello.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { buildApp } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";

describe("healthz", () => {
  it("returns ok", async () => {
    process.env.PI_WEB_UI_ROOT = `/tmp/pi-web-ui-test-${Date.now()}`;
    const app = await buildApp(loadConfig());
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });
});
```

- [ ] **Step 8: Install and run tests**

```bash
cd /Users/gengcc/Documents/project/pi-web-ui
pnpm install
pnpm --filter @pi-web-ui/server typecheck
pnpm --filter @pi-web-ui/server test
```

Expected: typecheck passes, test passes.

- [ ] **Step 9: Commit**

```bash
git add apps/server
git commit -m "feat(server): app skeleton with /healthz"
```

### Task 4: Web app skeleton

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`, `apps/web/vitest.config.ts`, `apps/web/index.html`, `apps/web/src/main.ts`, `apps/web/src/App.vue`

- [ ] **Step 1: Write `apps/web/package.json`**

```json
{
  "name": "@pi-web-ui/web",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vue-tsc --noEmit && vite build",
    "preview": "vite preview",
    "typecheck": "vue-tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@pi-web-ui/shared": "workspace:*",
    "naive-ui": "2.39.0",
    "pinia": "2.1.7",
    "vue": "3.4.31",
    "vue-router": "4.4.0"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "5.0.5",
    "@vue/test-utils": "2.4.6",
    "jsdom": "24.1.0",
    "typescript": "5.5.4",
    "vite": "5.3.3",
    "vitest": "1.6.0",
    "vue-tsc": "2.0.26"
  }
}
```

- [ ] **Step 2: Write `apps/web/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "preserve",
    "types": ["vite/client", "node"]
  },
  "include": ["src/**/*", "src/**/*.vue", "tests/**/*"]
}
```

- [ ] **Step 3: Write `apps/web/vite.config.ts`**

```ts
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:5174",
      "/ws": { target: "ws://127.0.0.1:5174", ws: true },
    },
  },
  test: {
    environment: "jsdom",
    globals: false,
  },
});
```

- [ ] **Step 4: Write `apps/web/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>pi-web-ui</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 5: Write `apps/web/src/main.ts`**

```ts
import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";

const app = createApp(App);
app.use(createPinia());
app.mount("#app");
```

- [ ] **Step 6: Write `apps/web/src/App.vue`**

```vue
<script setup lang="ts">
import { NConfigProvider, NMessageProvider } from "naive-ui";
</script>

<template>
  <NConfigProvider>
    <NMessageProvider>
      <div class="app">
        <h1>pi-web-ui</h1>
        <p>Hello from the skeleton.</p>
      </div>
    </NMessageProvider>
  </NConfigProvider>
</template>
```

- [ ] **Step 7: Install and run dev server (smoke test)**

```bash
cd /Users/gengcc/Documents/project/pi-web-ui
pnpm install
pnpm --filter @pi-web-ui/web typecheck
```

Expected: typecheck passes. (We don't run `pnpm dev` here; we'll do that in a later task.)

- [ ] **Step 8: Commit**

```bash
git add apps/web
git commit -m "feat(web): app skeleton with Naive UI"
```

---

## Phase 1: Process layer

### Task 5: Process manager (TDD)

**Files:**
- Create: `apps/server/src/agent/types.ts`, `apps/server/src/agent/process-manager.ts`
- Test: `apps/server/tests/unit/process-manager.test.ts`

- [ ] **Step 1: Write `apps/server/src/agent/types.ts`**

```ts
import { Readable, Writable } from "node:stream";
import { ServerEvent } from "@pi-web-ui/shared";

export interface AgentProcess {
  sessionId: string;
  projectId: string;
  workdir: string;
  stdin: Writable;
  stdout: Readable;
  pid: number | undefined;
  startedAt: number;
  lastActivityAt: number;
  status: "starting" | "active" | "idle" | "suspended" | "crashed";
  on(event: "event", listener: (e: ServerEvent) => void): void;
  on(event: "exit", listener: (code: number | null) => void): void;
  on(event: "stderr", listener: (line: string) => void): void;
  off(event: string, listener: (...args: unknown[]) => void): void;
  writeCommand(command: object): void;
  kill(): void;
}

export interface SpawnOptions {
  sessionId: string;
  projectId: string;
  workdir: string;
  command: string;
  args: string[];
}
```

- [ ] **Step 2: Write the failing test `apps/server/tests/unit/process-manager.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import { ProcessManager } from "../../src/agent/process-manager.js";
import { AgentProcess } from "../../src/agent/types.js";

class FakeProcess extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  pid = 1234;
  killed = false;
  kill() { this.killed = true; this.emit("exit", null); }
}

describe("ProcessManager", () => {
  let spawner: ReturnType<typeof vi.fn>;
  let manager: ProcessManager;

  beforeEach(() => {
    spawner = vi.fn((_cmd: string, _args: string[], _opts: object) => new FakeProcess());
    manager = new ProcessManager({ spawn: spawner, command: "pi", args: ["--rpc"] });
  });

  it("spawns a process on start", async () => {
    const p = await manager.start({ sessionId: "s1", projectId: "p1", workdir: "/tmp" });
    expect(p.sessionId).toBe("s1");
    expect(spawner).toHaveBeenCalledWith("pi", ["--rpc"], expect.objectContaining({ cwd: "/tmp" }));
  });

  it("returns the same process on get", async () => {
    const p = await manager.start({ sessionId: "s1", projectId: "p1", workdir: "/tmp" });
    expect(manager.get("s1")).toBe(p);
  });

  it("stops the process on stop", async () => {
    const proc = new FakeProcess();
    spawner.mockReturnValueOnce(proc);
    await manager.start({ sessionId: "s1", projectId: "p1", workdir: "/tmp" });
    manager.stop("s1");
    expect(proc.killed).toBe(true);
  });

  it("marks the process crashed when exit code != 0", async () => {
    const proc = new FakeProcess();
    spawner.mockReturnValueOnce(proc);
    await manager.start({ sessionId: "s1", projectId: "p1", workdir: "/tmp" });
    proc.emit("exit", 1);
    expect(manager.get("s1")?.status).toBe("crashed");
  });

  it("stops all processes on shutdown", async () => {
    const a = new FakeProcess();
    const b = new FakeProcess();
    spawner.mockReturnValueOnce(a).mockReturnValueOnce(b);
    await manager.start({ sessionId: "a", projectId: "p", workdir: "/tmp" });
    await manager.start({ sessionId: "b", projectId: "p", workdir: "/tmp" });
    await manager.shutdown();
    expect(a.killed).toBe(true);
    expect(b.killed).toBe(true);
  });
});
```

- [ ] **Step 3: Run test, verify failure**

```bash
cd /Users/gengcc/Documents/project/pi-web-ui
pnpm --filter @pi-web-ui/server test -- process-manager
```

Expected: FAIL with "Cannot find module ... process-manager.js"

- [ ] **Step 4: Implement `apps/server/src/agent/process-manager.ts`**

```ts
import { ChildProcess, spawn, SpawnOptions as NodeSpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { ServerEvent } from "@pi-web-ui/shared";
import { AgentProcess, SpawnOptions } from "./types.js";

type Spawner = (cmd: string, args: string[], opts: NodeSpawnOptions) => ChildProcess;

export interface ProcessManagerOptions {
  spawn?: Spawner;
  command: string;
  args: string[];
}

export class ProcessManager extends EventEmitter {
  private procs = new Map<string, AgentProcess>();
  private spawn: Spawner;
  private command: string;
  private args: string[];

  constructor(opts: ProcessManagerOptions) {
    super();
    this.spawn = opts.spawn ?? ((c, a, o) => spawn(c, a, o) as ChildProcess);
    this.command = opts.command;
    this.args = opts.args;
  }

  async start(input: { sessionId: string; projectId: string; workdir: string }): Promise<AgentProcess> {
    if (this.procs.has(input.sessionId)) {
      const existing = this.procs.get(input.sessionId)!;
      if (existing.status !== "crashed" && existing.status !== "suspended") return existing;
    }
    const child = this.spawn(this.command, this.args, {
      cwd: input.workdir,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PI_RPC: "1" },
    });

    const proc: AgentProcess = new EventEmitter() as AgentProcess;
    Object.assign(proc, {
      sessionId: input.sessionId,
      projectId: input.projectId,
      workdir: input.workdir,
      stdin: child.stdin!,
      stdout: child.stdout!,
      pid: child.pid,
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
      status: "starting" as const,
      writeCommand(cmd: object) {
        child.stdin!.write(JSON.stringify(cmd) + "\n");
      },
      kill() { child.kill("SIGTERM"); },
    });

    child.stdout!.on("data", (chunk: Buffer) => {
      proc.lastActivityAt = Date.now();
    });
    child.stderr!.on("data", (chunk: Buffer) => {
      const line = chunk.toString();
      line.split("\n").filter(Boolean).forEach((l) => (proc as EventEmitter).emit("stderr", l));
    });
    child.on("exit", (code) => {
      proc.status = code === 0 ? "suspended" : "crashed";
      (proc as EventEmitter).emit("exit", code);
    });

    this.procs.set(input.sessionId, proc);
    proc.status = "active";
    return proc;
  }

  get(sessionId: string): AgentProcess | undefined {
    return this.procs.get(sessionId);
  }

  stop(sessionId: string): void {
    const p = this.procs.get(sessionId);
    if (p) p.kill();
  }

  async shutdown(): Promise<void> {
    for (const p of this.procs.values()) p.kill();
    this.procs.clear();
  }
}
```

- [ ] **Step 5: Run test, verify pass**

```bash
cd /Users/gengcc/Documents/project/pi-web-ui
pnpm --filter @pi-web-ui/server test -- process-manager
```

Expected: 5 tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/agent/types.ts apps/server/src/agent/process-manager.ts apps/server/tests/unit/process-manager.test.ts
git commit -m "feat(server): process manager with crash detection"
```

### Task 6: RPC bridge (TDD)

**Files:**
- Create: `apps/server/src/agent/rpc-bridge.ts`, `apps/server/tests/fixtures/mock-pi.ts`
- Test: `apps/server/tests/unit/rpc-bridge.test.ts`

- [ ] **Step 1: Write the failing test `apps/server/tests/unit/rpc-bridge.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import { RpcBridge } from "../../src/agent/rpc-bridge.js";

function makeProc() {
  const proc: any = new EventEmitter();
  proc.stdin = new PassThrough();
  proc.stdout = new PassThrough();
  return proc;
}

describe("RpcBridge", () => {
  it("parses a complete JSON line from stdout and emits an event", () => {
    const proc = makeProc();
    const bridge = new RpcBridge(proc, "s1");
    const onEvent = vi.fn();
    bridge.onEvent(onEvent);

    proc.stdout.write(JSON.stringify({ type: "message_delta", sessionId: "s1", messageId: "m1", delta: "hi" }) + "\n");
    expect(onEvent).toHaveBeenCalledWith({
      type: "message_delta",
      sessionId: "s1",
      messageId: "m1",
      delta: "hi",
    });
  });

  it("buffers partial lines across chunks", () => {
    const proc = makeProc();
    const bridge = new RpcBridge(proc, "s1");
    const onEvent = vi.fn();
    bridge.onEvent(onEvent);

    const line = JSON.stringify({ type: "message_delta", sessionId: "s1", messageId: "m1", delta: "hello" });
    proc.stdout.write(line.slice(0, 10));
    proc.stdout.write(line.slice(10) + "\n");
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it("writes commands to stdin as JSON lines", () => {
    const proc = makeProc();
    const bridge = new RpcBridge(proc, "s1");
    const writeSpy = vi.spyOn(proc.stdin, "write");
    bridge.send({ type: "send", sessionId: "s1", content: "hi" });
    expect(writeSpy).toHaveBeenCalledWith(JSON.stringify({ type: "send", sessionId: "s1", content: "hi" }) + "\n");
  });

  it("ignores malformed JSON", () => {
    const proc = makeProc();
    const bridge = new RpcBridge(proc, "s1");
    const onEvent = vi.fn();
    bridge.onEvent(onEvent);
    proc.stdout.write("not json\n");
    expect(onEvent).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test, verify failure**

```bash
cd /Users/gengcc/Documents/project/pi-web-ui
pnpm --filter @pi-web-ui/server test -- rpc-bridge
```

Expected: FAIL with "Cannot find module ... rpc-bridge.js"

- [ ] **Step 3: Implement `apps/server/src/agent/rpc-bridge.ts`**

```ts
import { Writable, Readable } from "node:stream";
import { EventEmitter } from "node:events";
import { ServerEvent } from "@pi-web-ui/shared";

export interface RpcProcess {
  stdin: Writable;
  stdout: Readable;
}

export class RpcBridge extends EventEmitter {
  private buffer = "";

  constructor(private proc: RpcProcess, private sessionId: string) {
    super();
    this.proc.stdout.setEncoding("utf8");
    this.proc.stdout.on("data", (chunk: string) => this.handleChunk(chunk));
  }

  private handleChunk(chunk: string) {
    this.buffer += chunk;
    let idx;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as ServerEvent;
        this.emitEvent(event);
      } catch {
        // malformed, ignore
      }
    }
  }

  onEvent(listener: (e: ServerEvent) => void): void {
    this.on("event", listener);
  }

  emitEvent(event: ServerEvent): void {
    this.emit("event", event);
  }

  send(command: object): void {
    this.proc.stdin.write(JSON.stringify(command) + "\n");
  }
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
cd /Users/gengcc/Documents/project/pi-web-ui
pnpm --filter @pi-web-ui/server test -- rpc-bridge
```

Expected: 4 tests pass.

- [ ] **Step 5: Write `apps/server/tests/fixtures/mock-pi.ts`** (helper for later tests)

```ts
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";

export interface MockPi {
  proc: any;
  feed(line: object): void;
  feedRaw(s: string): void;
  expectCommand(cmd: object): void;
  commands: object[];
  kill(): void;
}

export function createMockPi(): MockPi {
  const proc: any = new EventEmitter();
  proc.stdin = new PassThrough();
  proc.stdout = new PassThrough();
  const commands: object[] = [];
  proc.stdin.on("data", (chunk: Buffer) => {
    chunk.toString().split("\n").filter(Boolean).forEach((l) => {
      try { commands.push(JSON.parse(l)); } catch {}
    });
  });
  return {
    proc,
    commands,
    feed(line) { proc.stdout.write(JSON.stringify(line) + "\n"); },
    feedRaw(s) { proc.stdout.write(s); },
    expectCommand(cmd) {
      if (JSON.stringify(commands[0]) !== JSON.stringify(cmd)) {
        throw new Error(`expected ${JSON.stringify(cmd)}, got ${JSON.stringify(commands[0])}`);
      }
    },
    kill() { proc.emit("exit", null); },
  };
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/agent/rpc-bridge.ts apps/server/tests/unit/rpc-bridge.test.ts apps/server/tests/fixtures/mock-pi.ts
git commit -m "feat(server): RPC bridge for stdio JSON-RPC"
```

---

## Phase 2: Persistence

### Task 7: SQLite setup & migrations

**Files:**
- Create: `apps/server/src/db/sqlite.ts`, `apps/server/src/db/migrations.ts`
- Test: `apps/server/tests/integration/migrations.test.ts`

- [ ] **Step 1: Write the failing test `apps/server/tests/integration/migrations.test.ts`**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations.js";

describe("migrations", () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(":memory:"); });

  it("creates projects, sessions, messages tables", () => {
    runMigrations(db);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as any[];
    const names = tables.map((t) => t.name);
    expect(names).toContain("projects");
    expect(names).toContain("sessions");
    expect(names).toContain("messages");
  });

  it("is idempotent", () => {
    runMigrations(db);
    runMigrations(db);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as any[];
    const names = tables.map((t) => t.name);
    expect(names.filter((n) => n.startsWith("projects") || n.startsWith("sessions") || n.startsWith("messages")).length).toBe(3);
  });
});
```

- [ ] **Step 2: Run test, verify failure**

```bash
cd /Users/gengcc/Documents/project/pi-web-ui
pnpm --filter @pi-web-ui/server test -- migrations
```

Expected: FAIL with "Cannot find module ... migrations.js"

- [ ] **Step 3: Write `apps/server/src/db/migrations.ts`**

```ts
import type Database from "better-sqlite3";

const MIGRATIONS = [
  {
    name: "001_initial",
    sql: `
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        workdir TEXT NOT NULL UNIQUE,
        description TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT,
        parent_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'active',
        pi_session_ref TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_active_at INTEGER
      );
      CREATE INDEX idx_sessions_project ON sessions(project_id);
      CREATE INDEX idx_sessions_parent ON sessions(parent_id);

      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        seq INTEGER NOT NULL
      );
      CREATE INDEX idx_messages_session_seq ON messages(session_id, seq);
    `,
  },
];

export function runMigrations(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);`);
  const applied = new Set(
    (db.prepare("SELECT name FROM _migrations").all() as { name: string }[]).map((r) => r.name),
  );
  const insert = db.prepare("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)");
  for (const m of MIGRATIONS) {
    if (applied.has(m.name)) continue;
    db.exec("BEGIN");
    try {
      db.exec(m.sql);
      insert.run(m.name, Date.now());
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
}
```

- [ ] **Step 4: Write `apps/server/src/db/sqlite.ts`**

```ts
import Database from "better-sqlite3";
import { runMigrations } from "./migrations.js";

export function openDatabase(path: string): Database.Database {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  return db;
}
```

- [ ] **Step 5: Run test, verify pass**

```bash
cd /Users/gengcc/Documents/project/pi-web-ui
pnpm --filter @pi-web-ui/server test -- migrations
```

Expected: 2 tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/db
git commit -m "feat(server): SQLite setup with initial schema"
```

### Task 8: Project repository (TDD)

**Files:**
- Create: `apps/server/src/util/ulid.ts`, `apps/server/src/db/repositories/project.ts`
- Test: `apps/server/tests/unit/project-repo.test.ts`

- [ ] **Step 1: Write `apps/server/src/util/ulid.ts`**

```ts
import { ulid as createUlid } from "ulid";
export function ulid(): string { return createUlid(); }
```

- [ ] **Step 2: Write the failing test `apps/server/tests/unit/project-repo.test.ts`**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations.js";
import { ProjectRepository } from "../../src/db/repositories/project.js";

describe("ProjectRepository", () => {
  let db: Database.Database;
  let repo: ProjectRepository;
  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    repo = new ProjectRepository(db);
  });

  it("creates and finds a project", () => {
    const p = repo.create({ name: "demo", workdir: "/tmp/demo" });
    expect(p.id).toBeDefined();
    const found = repo.findById(p.id);
    expect(found?.name).toBe("demo");
  });

  it("lists all projects", () => {
    repo.create({ name: "a", workdir: "/tmp/a" });
    repo.create({ name: "b", workdir: "/tmp/b" });
    expect(repo.list().map((p) => p.name).sort()).toEqual(["a", "b"]);
  });

  it("updates a project", () => {
    const p = repo.create({ name: "demo", workdir: "/tmp/demo" });
    repo.update(p.id, { name: "renamed" });
    expect(repo.findById(p.id)?.name).toBe("renamed");
  });

  it("deletes a project", () => {
    const p = repo.create({ name: "demo", workdir: "/tmp/demo" });
    repo.delete(p.id);
    expect(repo.findById(p.id)).toBeNull();
  });
});
```

- [ ] **Step 3: Run test, verify failure**

```bash
cd /Users/gengcc/Documents/project/pi-web-ui
pnpm --filter @pi-web-ui/server test -- project-repo
```

Expected: FAIL with "Cannot find module ... project.js"

- [ ] **Step 4: Implement `apps/server/src/db/repositories/project.ts`**

```ts
import type Database from "better-sqlite3";
import { ProjectDto } from "@pi-web-ui/shared";
import { ulid } from "../../util/ulid.js";

type ProjectRow = {
  id: string; name: string; workdir: string; description: string | null;
  created_at: number; updated_at: number;
};

function toDto(r: ProjectRow): ProjectDto {
  return {
    id: r.id, name: r.name, workdir: r.workdir, description: r.description,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export class ProjectRepository {
  constructor(private db: Database.Database) {}

  create(input: { id?: string; name: string; workdir: string; description?: string }): ProjectDto {
    const id = input.id ?? ulid();
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO projects (id, name, workdir, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, input.name, input.workdir, input.description ?? null, now, now);
    return { id, name: input.name, workdir: input.workdir, description: input.description ?? null, createdAt: now, updatedAt: now };
  }

  findById(id: string): ProjectDto | null {
    const r = this.db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
    return r ? toDto(r) : null;
  }

  list(): ProjectDto[] {
    return (this.db.prepare("SELECT * FROM projects ORDER BY updated_at DESC").all() as ProjectRow[]).map(toDto);
  }

  update(id: string, patch: Partial<{ name: string; description: string | null }>): void {
    const cur = this.findById(id);
    if (!cur) throw new Error("project not found");
    const name = patch.name ?? cur.name;
    const description = patch.description === undefined ? cur.description : patch.description;
    this.db.prepare("UPDATE projects SET name = ?, description = ?, updated_at = ? WHERE id = ?")
      .run(name, description, Date.now(), id);
  }

  delete(id: string): void {
    this.db.prepare("DELETE FROM projects WHERE id = ?").run(id);
  }
}
```

- [ ] **Step 5: Run test, verify pass**

```bash
cd /Users/gengcc/Documents/project/pi-web-ui
pnpm --filter @pi-web-ui/server test -- project-repo
```

Expected: 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/util/ulid.ts apps/server/src/db/repositories/project.ts apps/server/tests/unit/project-repo.test.ts
git commit -m "feat(server): project repository"
```

### Task 9: Session & message repositories (TDD)

**Files:**
- Create: `apps/server/src/db/repositories/session.ts`, `apps/server/src/db/repositories/message.ts`
- Test: `apps/server/tests/unit/{session,message}-repo.test.ts`

- [ ] **Step 1: Write `apps/server/tests/unit/session-repo.test.ts`**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations.js";
import { ProjectRepository } from "../../src/db/repositories/project.js";
import { SessionRepository } from "../../src/db/repositories/session.js";

describe("SessionRepository", () => {
  let db: Database.Database;
  let projects: ProjectRepository;
  let sessions: SessionRepository;
  let projectId: string;
  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    projects = new ProjectRepository(db);
    sessions = new SessionRepository(db);
    projectId = projects.create({ name: "p", workdir: "/tmp/p" }).id;
  });

  it("creates a session", () => {
    const s = sessions.create({ projectId });
    expect(s.projectId).toBe(projectId);
    expect(s.status).toBe("active");
  });

  it("supports a parent session (tree)", () => {
    const parent = sessions.create({ projectId });
    const child = sessions.create({ projectId, parentId: parent.id });
    expect(child.parentId).toBe(parent.id);
    expect(sessions.children(parent.id).map((c) => c.id)).toContain(child.id);
  });

  it("lists by project", () => {
    sessions.create({ projectId });
    sessions.create({ projectId });
    expect(sessions.listByProject(projectId).length).toBe(2);
  });

  it("updates status and last_active_at", () => {
    const s = sessions.create({ projectId });
    sessions.touch(s.id, "idle");
    expect(sessions.findById(s.id)?.status).toBe("idle");
  });
});
```

- [ ] **Step 2: Write `apps/server/tests/unit/message-repo.test.ts`**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations.js";
import { ProjectRepository } from "../../src/db/repositories/project.js";
import { SessionRepository } from "../../src/db/repositories/session.js";
import { MessageRepository } from "../../src/db/repositories/message.js";

describe("MessageRepository", () => {
  let db: Database.Database;
  let messages: MessageRepository;
  let sessionId: string;
  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    const projects = new ProjectRepository(db);
    const sessions = new SessionRepository(db);
    const p = projects.create({ name: "p", workdir: "/tmp/p" });
    sessionId = sessions.create({ projectId: p.id }).id;
    messages = new MessageRepository(db);
  });

  it("appends messages with increasing seq", () => {
    const m1 = messages.append({ sessionId, role: "user", content: "hi" });
    const m2 = messages.append({ sessionId, role: "assistant", content: "hello" });
    expect(m1.seq).toBe(1);
    expect(m2.seq).toBe(2);
  });

  it("lists messages in seq order", () => {
    messages.append({ sessionId, role: "user", content: "hi" });
    messages.append({ sessionId, role: "assistant", content: "hello" });
    const list = messages.listBySession(sessionId);
    expect(list.map((m) => m.content)).toEqual(["hi", "hello"]);
  });
});
```

- [ ] **Step 3: Run tests, verify failure**

```bash
cd /Users/gengcc/Documents/project/pi-web-ui
pnpm --filter @pi-web-ui/server test -- session-repo message-repo
```

Expected: FAIL with "Cannot find module ..."

- [ ] **Step 4: Implement `apps/server/src/db/repositories/session.ts`**

```ts
import type Database from "better-sqlite3";
import { SessionDto, SessionStatus } from "@pi-web-ui/shared";
import { ulid } from "../../util/ulid.js";

type Row = {
  id: string; project_id: string; title: string | null; parent_id: string | null;
  status: SessionStatus; pi_session_ref: string | null;
  created_at: number; updated_at: number; last_active_at: number | null;
};

function toDto(r: Row): SessionDto {
  return {
    id: r.id, projectId: r.project_id, title: r.title, parentId: r.parent_id,
    status: r.status, createdAt: r.created_at, updatedAt: r.updated_at, lastActiveAt: r.last_active_at,
  };
}

export class SessionRepository {
  constructor(private db: Database.Database) {}

  create(input: { projectId: string; parentId?: string; title?: string }): SessionDto {
    const id = ulid();
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO sessions (id, project_id, title, parent_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'active', ?, ?)
    `).run(id, input.projectId, input.title ?? null, input.parentId ?? null, now, now);
    return {
      id, projectId: input.projectId, title: input.title ?? null, parentId: input.parentId ?? null,
      status: "active", createdAt: now, updatedAt: now, lastActiveAt: null,
    };
  }

  findById(id: string): SessionDto | null {
    const r = this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as Row | undefined;
    return r ? toDto(r) : null;
  }

  listByProject(projectId: string): SessionDto[] {
    return (this.db.prepare("SELECT * FROM sessions WHERE project_id = ? ORDER BY updated_at DESC").all(projectId) as Row[]).map(toDto);
  }

  children(parentId: string): SessionDto[] {
    return (this.db.prepare("SELECT * FROM sessions WHERE parent_id = ?").all(parentId) as Row[]).map(toDto);
  }

  touch(id: string, status: SessionStatus, opts?: { title?: string; piSessionRef?: string }): void {
    const now = Date.now();
    const cur = this.findById(id);
    if (!cur) throw new Error("session not found");
    this.db.prepare(`
      UPDATE sessions
      SET status = ?, last_active_at = ?, updated_at = ?, title = COALESCE(?, title), pi_session_ref = COALESCE(?, pi_session_ref)
      WHERE id = ?
    `).run(status, now, now, opts?.title ?? null, opts?.piSessionRef ?? null, id);
  }

  setStatus(id: string, status: SessionStatus): void {
    this.db.prepare("UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?").run(status, Date.now(), id);
  }

  markActiveAsCrashed(): void {
    this.db.prepare("UPDATE sessions SET status = 'crashed', updated_at = ? WHERE status = 'active' OR status = 'idle'").run(Date.now());
  }

  delete(id: string): void {
    this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  }
}
```

- [ ] **Step 5: Implement `apps/server/src/db/repositories/message.ts`**

```ts
import type Database from "better-sqlite3";
import { MessageDto } from "@pi-web-ui/shared";
import { ulid } from "../../util/ulid.js";

type Row = {
  id: string; session_id: string; role: "user" | "assistant" | "tool";
  content: string | null; metadata: string | null;
  created_at: number; seq: number;
};

function toDto(r: Row): MessageDto {
  return {
    id: r.id, sessionId: r.session_id, role: r.role, content: r.content,
    metadata: r.metadata ? JSON.parse(r.metadata) : null,
    createdAt: r.created_at, seq: r.seq,
  };
}

export class MessageRepository {
  constructor(private db: Database.Database) {}

  append(input: { sessionId: string; role: "user" | "assistant" | "tool"; content: string; metadata?: Record<string, unknown> }): MessageDto {
    const id = ulid();
    const now = Date.now();
    const seqRow = this.db.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM messages WHERE session_id = ?").get(input.sessionId) as { next: number };
    this.db.prepare(`
      INSERT INTO messages (id, session_id, role, content, metadata, created_at, seq)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.sessionId, input.role, input.content, input.metadata ? JSON.stringify(input.metadata) : null, now, seqRow.next);
    return {
      id, sessionId: input.sessionId, role: input.role, content: input.content,
      metadata: input.metadata ?? null, createdAt: now, seq: seqRow.next,
    };
  }

  listBySession(sessionId: string): MessageDto[] {
    return (this.db.prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY seq ASC").all(sessionId) as Row[]).map(toDto);
  }
}
```

- [ ] **Step 6: Run tests, verify pass**

```bash
cd /Users/gengcc/Documents/project/pi-web-ui
pnpm --filter @pi-web-ui/server test -- session-repo message-repo
```

Expected: 6 tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/db/repositories apps/server/tests/unit
git commit -m "feat(server): session and message repositories"
```

### Task 10: Workdir manager (TDD)

**Files:**
- Create: `apps/server/src/workdir/manager.ts`
- Test: `apps/server/tests/unit/workdir-manager.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { WorkdirManager } from "../../src/workdir/manager.js";

describe("WorkdirManager", () => {
  let root: string;
  let mgr: WorkdirManager;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-test-"));
    mgr = new WorkdirManager({ root });
  });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it("creates a project workdir with .pi-web/ inside", () => {
    const wd = mgr.create("p1");
    expect(fs.existsSync(wd)).toBe(true);
    expect(fs.existsSync(path.join(wd, ".pi-web"))).toBe(true);
    expect(fs.existsSync(path.join(wd, ".pi-web", "config.json"))).toBe(true);
  });

  it("rejects duplicate project ids", () => {
    mgr.create("p1");
    expect(() => mgr.create("p1")).toThrow();
  });

  it("deletes a workdir", () => {
    const wd = mgr.create("p2");
    mgr.delete("p2");
    expect(fs.existsSync(wd)).toBe(false);
  });

  it("checks existence", () => {
    const wd = mgr.create("p3");
    expect(mgr.exists("p3")).toBe(true);
    fs.rmSync(wd, { recursive: true, force: true });
    expect(mgr.exists("p3")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, verify failure**

```bash
cd /Users/gengcc/Documents/project/pi-web-ui
pnpm --filter @pi-web-ui/server test -- workdir-manager
```

Expected: FAIL

- [ ] **Step 3: Implement `apps/server/src/workdir/manager.ts`**

```ts
import fs from "node:fs";
import path from "node:path";

export interface WorkdirManagerOptions {
  root: string;
}

export class WorkdirManager {
  constructor(private opts: WorkdirManagerOptions) {
    fs.mkdirSync(this.opts.root, { recursive: true });
  }

  path(projectId: string): string {
    return path.join(this.opts.root, projectId);
  }

  exists(projectId: string): boolean {
    return fs.existsSync(this.path(projectId));
  }

  create(projectId: string): string {
    const wd = this.path(projectId);
    if (fs.existsSync(wd)) throw new Error("project workdir already exists");
    fs.mkdirSync(wd, { recursive: true });
    fs.mkdirSync(path.join(wd, ".pi-web"), { recursive: true });
    fs.writeFileSync(path.join(wd, ".pi-web", "config.json"), JSON.stringify({ projectId, createdAt: Date.now() }, null, 2));
    return wd;
  }

  delete(projectId: string): void {
    fs.rmSync(this.path(projectId), { recursive: true, force: true });
  }
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
cd /Users/gengcc/Documents/project/pi-web-ui
pnpm --filter @pi-web-ui/server test -- workdir-manager
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/workdir apps/server/tests/unit/workdir-manager.test.ts
git commit -m "feat(server): workdir manager"
```

### Task 11: Project REST routes

**Files:**
- Create: `apps/server/src/routes/projects.ts`
- Modify: `apps/server/src/app.ts`
- Test: `apps/server/tests/integration/projects.test.ts`

- [ ] **Step 1: Write `apps/server/tests/integration/projects.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { buildApp } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";
import { openDatabase } from "../../src/db/sqlite.js";
import { ProjectRepository } from "../../src/db/repositories/project.js";
import { WorkdirManager } from "../../src/workdir/manager.js";

describe("projects routes", () => {
  let tmp: string;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-routes-"));
    process.env.PI_WEB_UI_ROOT = tmp;
    const config = loadConfig();
    const db = openDatabase(config.dbPath);
    app = await buildApp(config);
    (app as any).decorate("db", db);
    (app as any).decorate("projects", new ProjectRepository(db));
    (app as any).decorate("workdirs", new WorkdirManager({ root: config.workdirRoot }));
    await app.register((await import("../../src/routes/projects.js")).projectsRoutes, { prefix: "/api/projects" });
  });
  afterEach(async () => { await app.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

  it("creates a project", async () => {
    const res = await app.inject({ method: "POST", url: "/api/projects", payload: { name: "demo" } });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe("demo");
    expect(body.workdir).toContain("demo");
  });

  it("lists projects", async () => {
    await app.inject({ method: "POST", url: "/api/projects", payload: { name: "a" } });
    const res = await app.inject({ method: "GET", url: "/api/projects" });
    expect(res.json().length).toBe(1);
  });

  it("gets one project", async () => {
    const c = await app.inject({ method: "POST", url: "/api/projects", payload: { name: "a" } });
    const id = c.json().id;
    const res = await app.inject({ method: "GET", url: `/api/projects/${id}` });
    expect(res.json().id).toBe(id);
  });

  it("deletes a project", async () => {
    const c = await app.inject({ method: "POST", url: "/api/projects", payload: { name: "a" } });
    const id = c.json().id;
    const res = await app.inject({ method: "DELETE", url: `/api/projects/${id}` });
    expect(res.statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: `/api/projects/${id}` })).statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run test, verify failure**

```bash
cd /Users/gengcc/Documents/project/pi-web-ui
pnpm --filter @pi-web-ui/server test -- projects-routes
```

Expected: FAIL

- [ ] **Step 3: Refactor `apps/server/src/app.ts` to accept DI**

Replace file with:

```ts
import Fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { Config } from "./config.js";
import { ProjectRepository } from "./db/repositories/project.js";
import { WorkdirManager } from "./workdir/manager.js";
import type Database from "better-sqlite3";

declare module "fastify" {
  interface FastifyInstance {
    db: Database.Database;
    projects: ProjectRepository;
    workdirs: WorkdirManager;
  }
}

export interface AppDeps {
  db: Database.Database;
  projects: ProjectRepository;
  workdirs: WorkdirManager;
}

export async function buildApp(config: Config, deps?: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: config.logLevel, transport: { target: "pino-pretty" } },
  });

  await app.register(cors, { origin: true, credentials: true });
  await app.register(websocket);

  if (deps) {
    app.decorate("db", deps.db);
    app.decorate("projects", deps.projects);
    app.decorate("workdirs", deps.workdirs);
  }

  app.get("/healthz", async () => ({ ok: true }));

  return app;
}
```

- [ ] **Step 4: Implement `apps/server/src/routes/projects.ts`**

```ts
import { FastifyPluginAsync } from "fastify";
import { ulid } from "../util/ulid.js";

export const projectsRoutes: FastifyPluginAsync = async (app) => {
  app.post("/", async (req, reply) => {
    const body = req.body as { name: string; description?: string };
    if (!body?.name) return reply.code(400).send({ error: "name required" });
    const id = ulid();
    const workdir = app.workdirs.path(id);
    app.workdirs.create(id);
    const p = app.projects.create({ id, name: body.name, workdir, description: body.description });
    return reply.code(201).send(p);
  });

  app.get("/", async () => app.projects.list());

  app.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const p = app.projects.findById(req.params.id);
    if (!p) return reply.code(404).send({ error: "not found" });
    return p;
  });

  app.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const p = app.projects.findById(req.params.id);
    if (!p) return reply.code(404).send({ error: "not found" });
    app.projects.delete(req.params.id);
    try { app.workdirs.delete(req.params.id); } catch {}
    return reply.code(204).send();
  });
};
```

- [ ] **Step 5: Update test to use deps**

Replace the test's `beforeEach` to:

```ts
beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-routes-"));
  process.env.PI_WEB_UI_ROOT = tmp;
  const config = loadConfig();
  const db = openDatabase(config.dbPath);
  app = await buildApp(config, {
    db,
    projects: new ProjectRepository(db),
    workdirs: new WorkdirManager({ root: config.workdirRoot }),
  });
  await app.register((await import("../../src/routes/projects.js")).projectsRoutes, { prefix: "/api/projects" });
});
```

- [ ] **Step 6: Run test, verify pass**

```bash
cd /Users/gengcc/Documents/project/pi-web-ui
pnpm --filter @pi-web-ui/server test -- projects-routes
```

Expected: 4 tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/server
git commit -m "feat(server): project REST routes"
```

---

## Phase 3: Chat flow

### Task 12: WebSocket handler with session manager

**Files:**
- Create: `apps/server/src/agent/session-state.ts`, `apps/server/src/ws/agent.ts`
- Modify: `apps/server/src/app.ts`
- Test: `apps/server/tests/integration/ws.test.ts`

- [ ] **Step 1: Write `apps/server/src/agent/session-state.ts`**

```ts
import { RpcBridge } from "./rpc-bridge.js";
import { AgentProcess } from "./types.js";
import { ServerEvent } from "@pi-web-ui/shared";

export interface SessionState {
  sessionId: string;
  process: AgentProcess;
  bridge: RpcBridge;
  lastActivityAt: number;
}

export class SessionStateStore {
  private states = new Map<string, SessionState>();

  set(sessionId: string, process: AgentProcess, bridge: RpcBridge): SessionState {
    const state: SessionState = { sessionId, process, bridge, lastActivityAt: Date.now() };
    this.states.set(sessionId, state);
    return state;
  }

  get(sessionId: string): SessionState | undefined {
    return this.states.get(sessionId);
  }

  delete(sessionId: string): void {
    this.states.delete(sessionId);
  }

  values(): IterableIterator<SessionState> {
    return this.states.values();
  }

  touch(sessionId: string): void {
    const s = this.states.get(sessionId);
    if (s) s.lastActivityAt = Date.now();
  }
}
```

- [ ] **Step 2: Write `apps/server/src/ws/agent.ts`**

```ts
import { FastifyPluginAsync } from "fastify";
import { ClientEvent, ServerEvent } from "@pi-web-ui/shared";
import { ProcessManager } from "../agent/process-manager.js";
import { RpcBridge } from "../agent/rpc-bridge.js";
import { SessionStateStore } from "../agent/session-state.js";
import { SessionRepository } from "../db/repositories/session.js";
import { MessageRepository } from "../db/repositories/message.js";

declare module "fastify" {
  interface FastifyInstance {
    processManager: ProcessManager;
    sessionStates: SessionStateStore;
    sessions: SessionRepository;
    messages: MessageRepository;
  }
}

export const agentRoutes: FastifyPluginAsync = async (app) => {
  app.get("/ws/agent", { websocket: true }, (connection) => {
    const send = (event: ServerEvent) => {
      try { connection.send(JSON.stringify(event)); } catch {}
    };

    connection.on("message", async (raw: Buffer) => {
      let event: ClientEvent;
      try { event = JSON.parse(raw.toString()) as ClientEvent; } catch { return; }
      if (event.type === "ping") { send({ type: "pong" }); return; }

      const session = app.sessions.findById(event.sessionId);
      if (!session) { send({ type: "error", sessionId: event.sessionId, code: "no_session", message: "session not found" }); return; }

      let state = app.sessionStates.get(event.sessionId);
      if (!state) {
        const project = app.projects.findById(session.projectId);
        if (!project) { send({ type: "error", sessionId: event.sessionId, code: "no_project", message: "project gone" }); return; }
        const proc = await app.processManager.start({ sessionId: session.id, projectId: project.id, workdir: project.workdir });
        const bridge = new RpcBridge({ stdin: proc.stdin, stdout: proc.stdout }, session.id);
        bridge.onEvent((e) => {
          send(e);
          if (e.type === "message_end") {
            app.messages.append({ sessionId: e.sessionId, role: "assistant", content: e.content, metadata: e.metadata });
          }
        });
        proc.on("exit", (code) => send({ type: "session_status", sessionId: session.id, status: code === 0 ? "suspended" : "crashed" }));
        state = app.sessionStates.set(session.id, proc, bridge);
        app.sessions.touch(session.id, "active");
      }

      app.sessionStates.touch(event.sessionId);
          if (event.type === "send" || event.type === "steer") {
        state.bridge.send({ type: event.type, sessionId: event.sessionId, content: event.content });
        app.messages.append({ sessionId: event.sessionId, role: "user", content: event.content });
      } else if (event.type === "interrupt") {
        state.process.kill();
      } else if (event.type === "switchModel") {
        state.bridge.send({ type: "switchModel", sessionId: event.sessionId, model: event.model });
      }
    });
  });
};
```

- [ ] **Step 3: Update `apps/server/src/app.ts` to take session deps**

Replace the `AppDeps` interface and `buildApp` signature to include session-related deps:

```ts
import Fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { Config } from "./config.js";
import { ProjectRepository } from "./db/repositories/project.js";
import { SessionRepository } from "./db/repositories/session.js";
import { MessageRepository } from "./db/repositories/message.js";
import { WorkdirManager } from "./workdir/manager.js";
import { ProcessManager } from "./agent/process-manager.js";
import { SessionStateStore } from "./agent/session-state.js";
import type Database from "better-sqlite3";

declare module "fastify" {
  interface FastifyInstance {
    db: Database.Database;
    projects: ProjectRepository;
    sessions: SessionRepository;
    messages: MessageRepository;
    workdirs: WorkdirManager;
    processManager: ProcessManager;
    sessionStates: SessionStateStore;
  }
}

export interface AppDeps {
  db: Database.Database;
  projects: ProjectRepository;
  sessions: SessionRepository;
  messages: MessageRepository;
  workdirs: WorkdirManager;
  processManager: ProcessManager;
  sessionStates: SessionStateStore;
}

export async function buildApp(config: Config, deps?: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: config.logLevel, transport: { target: "pino-pretty" } } });
  await app.register(cors, { origin: true, credentials: true });
  await app.register(websocket);

  if (deps) {
    for (const [k, v] of Object.entries(deps)) app.decorate(k, v);
  }

  app.get("/healthz", async () => ({ ok: true }));
  return app;
}
```

- [ ] **Step 4: Write `apps/server/tests/integration/ws.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import WebSocket from "ws";
import { buildApp } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";
import { openDatabase } from "../../src/db/sqlite.js";
import { ProjectRepository } from "../../src/db/repositories/project.js";
import { SessionRepository } from "../../src/db/repositories/session.js";
import { MessageRepository } from "../../src/db/repositories/message.js";
import { WorkdirManager } from "../../src/workdir/manager.js";
import { ProcessManager } from "../../src/agent/process-manager.js";
import { SessionStateStore } from "../../src/agent/session-state.js";
import { agentRoutes } from "../../src/ws/agent.js";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";

function makeFakeProc() {
  const proc: any = new EventEmitter();
  proc.stdin = new PassThrough();
  proc.stdout = new PassThrough();
  proc.pid = 1;
  proc.kill = () => proc.emit("exit", null);
  return proc;
}

describe("ws agent", () => {
  let tmp: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let port: number;
  let sessionId: string;

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-ws-"));
    process.env.PI_WEB_UI_ROOT = tmp;
    const config = loadConfig();
    const db = openDatabase(config.dbPath);
    const workdirs = new WorkdirManager({ root: config.workdirRoot });
    const projects = new ProjectRepository(db);
    const project = projects.create({ name: "p", workdir: config.workdirRoot + "/x" });
    workdirs.create(project.id);
    db.prepare("UPDATE projects SET workdir = ? WHERE id = ?").run(workdirs.path(project.id), project.id);
    const sessions = new SessionRepository(db);
    sessionId = sessions.create({ projectId: project.id }).id;

    const fakeProc = makeFakeProc();
    const processManager = new ProcessManager({ spawn: () => fakeProc as any, command: "pi", args: [] });

    app = await buildApp(config, {
      db, projects, sessions, messages: new MessageRepository(db), workdirs,
      processManager, sessionStates: new SessionStateStore(),
    });
    await app.register(agentRoutes);
    await app.listen({ port: 0, host: "127.0.0.1" });
    const addr = app.server.address();
    port = typeof addr === "object" && addr ? addr.port : 0;
  });
  afterEach(async () => { await app.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

  it("sends a message and receives echoed events", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/agent`);
    const received: any[] = [];
    ws.on("message", (data) => received.push(JSON.parse(data.toString())));
    await new Promise((r) => ws.on("open", r));
    ws.send(JSON.stringify({ type: "send", sessionId, content: "hi" }));
    await new Promise((r) => setTimeout(r, 100));
    const stdout = (app.processManager.get(sessionId) as any).stdout as PassThrough;
    stdout.write(JSON.stringify({ type: "message_start", sessionId, messageId: "m1", role: "assistant" }) + "\n");
    stdout.write(JSON.stringify({ type: "message_delta", sessionId, messageId: "m1", delta: "hello" }) + "\n");
    await new Promise((r) => setTimeout(r, 100));
    ws.close();
    const types = received.map((e) => e.type);
    expect(types).toContain("message_start");
    expect(types).toContain("message_delta");
  });
});
```

- [ ] **Step 5: Add `ws` as dev dependency**

```bash
cd /Users/gengcc/Documents/project/pi-web-ui
pnpm --filter @pi-web-ui/server add -D ws @types/ws
```

- [ ] **Step 6: Run test, verify pass**

```bash
cd /Users/gengcc/Documents/project/pi-web-ui
pnpm --filter @pi-web-ui/server test -- ws
```

Expected: 1 test passes.

- [ ] **Step 7: Commit**

```bash
git add apps/server
git commit -m "feat(server): websocket handler with session manager"
```

### Task 13: Session REST routes

**Files:**
- Create: `apps/server/src/routes/sessions.ts`
- Test: `apps/server/tests/integration/sessions.test.ts`

- [ ] **Step 1: Write `apps/server/tests/integration/sessions.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs"; import path from "node:path"; import os from "node:os";
import { buildApp } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";
import { openDatabase } from "../../src/db/sqlite.js";
import { ProjectRepository } from "../../src/db/repositories/project.js";
import { SessionRepository } from "../../src/db/repositories/session.js";
import { MessageRepository } from "../../src/db/repositories/message.js";
import { WorkdirManager } from "../../src/workdir/manager.js";
import { ProcessManager } from "../../src/agent/process-manager.js";
import { SessionStateStore } from "../../src/agent/session-state.js";
import { sessionsRoutes } from "../../src/routes/sessions.js";

describe("sessions routes", () => {
  let tmp: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let projectId: string;

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-sess-"));
    process.env.PI_WEB_UI_ROOT = tmp;
    const config = loadConfig();
    const db = openDatabase(config.dbPath);
    const workdirs = new WorkdirManager({ root: config.workdirRoot });
    const projects = new ProjectRepository(db);
    const p = projects.create({ name: "p", workdir: config.workdirRoot + "/x" });
    workdirs.create(p.id);
    db.prepare("UPDATE projects SET workdir = ? WHERE id = ?").run(workdirs.path(p.id), p.id);
    projectId = p.id;
    const sessions = new SessionRepository(db);
    app = await buildApp(config, {
      db, projects, sessions, messages: new MessageRepository(db), workdirs,
      processManager: new ProcessManager({ command: "pi", args: [] }),
      sessionStates: new SessionStateStore(),
    });
    await app.register(sessionsRoutes, { prefix: "/api" });
  });
  afterEach(async () => { await app.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

  it("creates a session", async () => {
    const res = await app.inject({ method: "POST", url: `/api/projects/${projectId}/sessions`, payload: {} });
    expect(res.statusCode).toBe(201);
    expect(res.json().projectId).toBe(projectId);
  });

  it("lists sessions by project", async () => {
    await app.inject({ method: "POST", url: `/api/projects/${projectId}/sessions`, payload: {} });
    await app.inject({ method: "POST", url: `/api/projects/${projectId}/sessions`, payload: {} });
    const res = await app.inject({ method: "GET", url: `/api/projects/${projectId}/sessions` });
    expect(res.json().length).toBe(2);
  });

  it("fetches messages for a session", async () => {
    const c = await app.inject({ method: "POST", url: `/api/projects/${projectId}/sessions`, payload: {} });
    const sid = c.json().id;
    app.messages.append({ sessionId: sid, role: "user", content: "hi" });
    const res = await app.inject({ method: "GET", url: `/api/sessions/${sid}/messages` });
    expect(res.json()[0].content).toBe("hi");
  });
});
```

- [ ] **Step 2: Run test, verify failure**

```bash
cd /Users/gengcc/Documents/project/pi-web-ui
pnpm --filter @pi-web-ui/server test -- sessions-routes
```

Expected: FAIL

- [ ] **Step 3: Implement `apps/server/src/routes/sessions.ts`**

```ts
import { FastifyPluginAsync } from "fastify";

export const sessionsRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Params: { projectId: string } }>("/projects/:projectId/sessions", async (req, reply) => {
    const project = app.projects.findById(req.params.projectId);
    if (!project) return reply.code(404).send({ error: "project not found" });
    const body = (req.body ?? {}) as { parentId?: string; title?: string };
    const s = app.sessions.create({
      projectId: project.id,
      parentId: body.parentId,
      title: body.title,
    });
    return reply.code(201).send(s);
  });

  app.get<{ Params: { projectId: string } }>("/projects/:projectId/sessions", async (req) => {
    return app.sessions.listByProject(req.params.projectId);
  });

  app.get<{ Params: { id: string } }>("/sessions/:id", async (req, reply) => {
    const s = app.sessions.findById(req.params.id);
    if (!s) return reply.code(404).send({ error: "not found" });
    return s;
  });

  app.get<{ Params: { id: string } }>("/sessions/:id/messages", async (req, reply) => {
    const s = app.sessions.findById(req.params.id);
    if (!s) return reply.code(404).send({ error: "not found" });
    return app.messages.listBySession(req.params.id);
  });

  app.delete<{ Params: { id: string } }>("/sessions/:id", async (req, reply) => {
    const s = app.sessions.findById(req.params.id);
    if (!s) return reply.code(404).send({ error: "not found" });
    app.sessionStates.get(req.params.id)?.process.kill();
    app.sessionStates.delete(req.params.id);
    app.sessions.delete(req.params.id);
    return reply.code(204).send();
  });
};
```

- [ ] **Step 4: Run test, verify pass**

```bash
cd /Users/gengcc/Documents/project/pi-web-ui
pnpm --filter @pi-web-ui/server test -- sessions-routes
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/server
git commit -m "feat(server): session REST routes"
```

---

## Phase 4: Frontend stores and components

### Task 14: API and WebSocket clients

**Files:**
- Create: `apps/web/src/api/client.ts`, `apps/web/src/api/ws.ts`
- Test: `apps/web/tests/unit/{api-client,ws-client}.test.ts`

- [ ] **Step 1: Write `apps/web/src/api/client.ts`**

```ts
import type { ProjectDto, SessionDto, MessageDto, FileNodeDto, FileContentDto } from "@pi-web-ui/shared";

const BASE = "/api";

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} failed: ${res.status}`);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  listProjects: () => request<ProjectDto[]>("GET", "/projects"),
  createProject: (name: string, description?: string) =>
    request<ProjectDto>("POST", "/projects", { name, description }),
  getProject: (id: string) => request<ProjectDto>("GET", `/projects/${id}`),
  deleteProject: (id: string) => request<void>("DELETE", `/projects/${id}`),

  listSessions: (projectId: string) => request<SessionDto[]>("GET", `/projects/${projectId}/sessions`),
  createSession: (projectId: string, parentId?: string) =>
    request<SessionDto>("POST", `/projects/${projectId}/sessions`, { parentId }),
  getSession: (id: string) => request<SessionDto>("GET", `/sessions/${id}`),
  deleteSession: (id: string) => request<void>("DELETE", `/sessions/${id}`),
  listMessages: (sessionId: string) => request<MessageDto[]>("GET", `/sessions/${sessionId}/messages`),

  listFiles: (projectId: string, dir = "/") =>
    request<FileNodeDto[]>("GET", `/files/${projectId}/list?path=${encodeURIComponent(dir)}`),
  readFile: (projectId: string, path: string) =>
    request<FileContentDto>("GET", `/files/${projectId}/read?path=${encodeURIComponent(path)}`),
};
```

- [ ] **Step 2: Write `apps/web/src/api/ws.ts`**

```ts
import type { ClientEvent, ServerEvent } from "@pi-web-ui/shared";

type Listener = (e: ServerEvent) => void;

export class WsClient {
  private ws?: WebSocket;
  private listeners = new Set<Listener>();
  private reconnectAttempts = 0;
  private status: "disconnected" | "connecting" | "connected" = "disconnected";
  private statusListeners = new Set<(s: "disconnected" | "connecting" | "connected") => void>();
  private pingTimer?: number;

  connect() {
    if (this.ws) return;
    this.setStatus("connecting");
    const proto = location.protocol === "https:" ? "wss" : "ws";
    this.ws = new WebSocket(`${proto}://${location.host}/ws/agent`);
    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.setStatus("connected");
      this.pingTimer = window.setInterval(() => this.send({ type: "ping" }), 25000);
    };
    this.ws.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data) as ServerEvent;
        this.listeners.forEach((l) => l(event));
      } catch {}
    };
    this.ws.onclose = () => this.scheduleReconnect();
    this.ws.onerror = () => this.ws?.close();
  }

  private scheduleReconnect() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.setStatus("disconnected");
    this.ws = undefined;
    const delay = Math.min(30000, 1000 * 2 ** this.reconnectAttempts);
    this.reconnectAttempts++;
    setTimeout(() => this.connect(), delay);
  }

  private setStatus(s: "disconnected" | "connecting" | "connected") {
    this.status = s;
    this.statusListeners.forEach((l) => l(s));
  }

  send(event: ClientEvent) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(event));
  }

  onEvent(l: Listener) { this.listeners.add(l); return () => this.listeners.delete(l); }
  onStatusChange(l: (s: "disconnected" | "connecting" | "connected") => void) {
    this.statusListeners.add(l);
    l(this.status);
    return () => this.statusListeners.delete(l);
  }

  close() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.ws?.close();
  }
}

export const wsClient = new WsClient();
```

- [ ] **Step 3: Write `apps/web/tests/unit/api-client.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "../../src/api/client.js";

describe("api client", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("creates a project via POST", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "1", name: "x" }), { status: 201, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const p = await api.createProject("x");
    expect(p.id).toBe("1");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/projects");
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
  });
});
```

- [ ] **Step 4: Run, verify pass**

```bash
cd /Users/gengcc/Documents/project/pi-web-ui
pnpm --filter @pi-web-ui/web test
```

Expected: 1 test passes.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api apps/web/tests
git commit -m "feat(web): api and ws clients"
```

### Task 15: Pinia stores

**Files:**
- Create: `apps/web/src/stores/{project,session,agent,connection}.ts`
- Test: `apps/web/tests/unit/stores.test.ts`

- [ ] **Step 1: Write `apps/web/src/stores/connection.ts`**

```ts
import { defineStore } from "pinia";
import { wsClient } from "../api/ws.js";

export const useConnectionStore = defineStore("connection", {
  state: () => ({ status: "disconnected" as "disconnected" | "connecting" | "connected" }),
  actions: {
    init() {
      wsClient.onStatusChange((s) => { this.status = s; });
      wsClient.connect();
    },
  },
});
```

- [ ] **Step 2: Write `apps/web/src/stores/project.ts`**

```ts
import { defineStore } from "pinia";
import { api } from "../api/client.js";
import type { ProjectDto } from "@pi-web-ui/shared";

export const useProjectStore = defineStore("projects", {
  state: () => ({
    projects: [] as ProjectDto[],
    current: null as ProjectDto | null,
    loading: false,
  }),
  actions: {
    async loadAll() {
      this.loading = true;
      try { this.projects = await api.listProjects(); }
      finally { this.loading = false; }
    },
    async loadOne(id: string) {
      this.current = await api.getProject(id);
    },
    async create(name: string, description?: string) {
      const p = await api.createProject(name, description);
      this.projects.unshift(p);
      return p;
    },
    async remove(id: string) {
      await api.deleteProject(id);
      this.projects = this.projects.filter((p) => p.id !== id);
    },
  },
});
```

- [ ] **Step 3: Write `apps/web/src/stores/session.ts`**

```ts
import { defineStore } from "pinia";
import { api } from "../api/client.js";
import type { SessionDto, MessageDto } from "@pi-web-ui/shared";

export const useSessionStore = defineStore("sessions", {
  state: () => ({
    sessions: [] as SessionDto[],
    current: null as SessionDto | null,
    messages: [] as MessageDto[],
  }),
  actions: {
    async loadForProject(projectId: string) {
      this.sessions = await api.listSessions(projectId);
    },
    async create(projectId: string, parentId?: string) {
      const s = await api.createSession(projectId, parentId);
      this.sessions.unshift(s);
      return s;
    },
    async open(id: string) {
      this.current = await api.getSession(id);
      this.messages = await api.listMessages(id);
    },
    async remove(id: string) {
      await api.deleteSession(id);
      this.sessions = this.sessions.filter((s) => s.id !== id);
    },
  },
});
```

- [ ] **Step 4: Write `apps/web/src/stores/agent.ts`**

```ts
import { defineStore } from "pinia";
import { wsClient } from "../api/ws.js";
import type { ServerEvent } from "@pi-web-ui/shared";

interface StreamMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "streaming" | "complete";
}

export const useAgentStore = defineStore("agent", {
  state: () => ({
    streams: {} as Record<string, StreamMessage[]>, // by sessionId
  }),
  getters: {
    messagesFor: (state) => (sessionId: string): StreamMessage[] => state.streams[sessionId] ?? [],
  },
  actions: {
    init() {
      wsClient.onEvent((e) => this.handle(e));
    },
    send(sessionId: string, content: string) {
      this.appendUser(sessionId, content);
      wsClient.send({ type: "send", sessionId, content });
    },
    interrupt(sessionId: string) {
      wsClient.send({ type: "interrupt", sessionId });
    },
    appendUser(sessionId: string, content: string) {
      const msg: StreamMessage = { id: `u-${Date.now()}`, role: "user", content, status: "complete" };
      this.streams[sessionId] = [...(this.streams[sessionId] ?? []), msg];
    },
    handle(e: ServerEvent) {
      if (!("sessionId" in e) || !e.sessionId) return;
      const sid = e.sessionId;
      const list = this.streams[sid] ?? [];
      if (e.type === "message_start") {
        this.streams[sid] = [...list, { id: e.messageId, role: e.role, content: "", status: "streaming" }];
      } else if (e.type === "message_delta") {
        this.streams[sid] = list.map((m) => m.id === e.messageId ? { ...m, content: m.content + e.delta } : m);
      } else if (e.type === "message_end") {
        this.streams[sid] = list.map((m) => m.id === e.messageId ? { ...m, content: e.content, status: "complete" } : m);
      } else if (e.type === "session_status") {
        // session-status updates would be wired into the session store
      }
    },
  },
});
```

- [ ] **Step 5: Write `apps/web/tests/unit/stores.test.ts`**

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useProjectStore } from "../../src/stores/project.js";

describe("project store", () => {
  beforeEach(() => { setActivePinia(createPinia()); vi.restoreAllMocks(); });

  it("loads and creates projects", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "1", name: "x" }), { status: 201, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const store = useProjectStore();
    await store.loadAll();
    await store.create("x");
    expect(store.projects.length).toBe(1);
  });
});
```

- [ ] **Step 6: Run, verify pass**

```bash
cd /Users/gengcc/Documents/project/pi-web-ui
pnpm --filter @pi-web-ui/web test
```

Expected: 2 tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/stores apps/web/tests/unit/stores.test.ts
git commit -m "feat(web): pinia stores for project, session, agent, connection"
```

### Task 16: ChatPanel component

**Files:**
- Create: `apps/web/src/components/ChatPanel.vue`

- [ ] **Step 1: Write `apps/web/src/components/ChatPanel.vue`**

```vue
<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { NInput, NButton, NEmpty, NSpin } from "naive-ui";
import { useAgentStore } from "../stores/agent.js";

const props = defineProps<{ sessionId: string }>();
const agent = useAgentStore();
const input = ref("");

const messages = computed(() => agent.messagesFor(props.sessionId));

const persistedMessages = ref<{ id: string; role: string; content: string }[]>([]);
import { api } from "../api/client.js";
onMounted(async () => {
  persistedMessages.value = await api.listMessages(props.sessionId);
});

function send() {
  if (!input.value.trim()) return;
  agent.send(props.sessionId, input.value);
  input.value = "";
}
</script>

<template>
  <div class="chat-panel">
    <div class="messages">
      <div v-for="m in persistedMessages" :key="m.id" :class="['msg', m.role]">
        <div class="role">{{ m.role }}</div>
        <div class="content">{{ m.content }}</div>
      </div>
      <div v-for="m in messages" :key="m.id" :class="['msg', m.role]">
        <div class="role">{{ m.role }}<span v-if="m.status === 'streaming'">…</span></div>
        <div class="content">{{ m.content }}</div>
      </div>
      <NEmpty v-if="!messages.length && !persistedMessages.length" description="No messages yet" />
    </div>
    <div class="composer">
      <NInput v-model:value="input" type="textarea" :rows="2" placeholder="Send a message..." @keydown.enter.exact.prevent="send" />
      <NButton type="primary" @click="send">Send</NButton>
    </div>
  </div>
</template>

<style scoped>
.chat-panel { display: flex; flex-direction: column; height: 100%; }
.messages { flex: 1; overflow-y: auto; padding: 12px; }
.msg { margin: 8px 0; padding: 8px 12px; border-radius: 6px; }
.msg.user { background: #e6f7ff; }
.msg.assistant { background: #f6ffed; }
.role { font-size: 0.75em; color: #888; text-transform: uppercase; }
.composer { display: flex; gap: 8px; padding: 12px; border-top: 1px solid #eee; }
</style>
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/gengcc/Documents/project/pi-web-ui
pnpm --filter @pi-web-ui/web typecheck
```

Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ChatPanel.vue
git commit -m "feat(web): ChatPanel with streaming + persisted messages"
```

### Task 17: File routes (server) + FileTree & FileViewer components

**Files:**
- Create: `apps/server/src/routes/files.ts`, `apps/web/src/components/{FileTree,FileViewer}.vue`

- [ ] **Step 1: Implement `apps/server/src/routes/files.ts`**

```ts
import { FastifyPluginAsync } from "fastify";
import fs from "node:fs/promises";
import path from "node:path";
import type { FileNodeDto, FileContentDto } from "@pi-web-ui/shared";

async function buildTree(root: string, rel: string, depth: number): Promise<FileNodeDto[]> {
  if (depth > 6) return [];
  const abs = path.join(root, rel);
  const entries = await fs.readdir(abs, { withFileTypes: true });
  const out: FileNodeDto[] = [];
  for (const e of entries) {
    if (e.name.startsWith(".") && e.name !== ".pi-web") continue;
    if (e.name === "node_modules") continue;
    const childRel = rel === "/" ? e.name : `${rel}/${e.name}`;
    if (e.isDirectory()) {
      out.push({ name: e.name, path: childRel, type: "directory", children: await buildTree(root, childRel, depth + 1) });
    } else {
      const stat = await fs.stat(path.join(root, childRel));
      out.push({ name: e.name, path: childRel, type: "file", size: stat.size });
    }
  }
  return out;
}

export const filesRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { projectId: string }; Querystring: { path?: string } }>("/files/:projectId/list", async (req, reply) => {
    const project = app.projects.findById(req.params.projectId);
    if (!project) return reply.code(404).send({ error: "project not found" });
    const rel = req.query.path ?? "/";
    const abs = path.join(project.workdir, rel);
    if (!abs.startsWith(project.workdir)) return reply.code(400).send({ error: "bad path" });
    const tree = await buildTree(project.workdir, rel, 0);
    return tree;
  });

  app.get<{ Params: { projectId: string }; Querystring: { path: string } }>("/files/:projectId/read", async (req, reply) => {
    const project = app.projects.findById(req.params.projectId);
    if (!project) return reply.code(404).send({ error: "project not found" });
    const rel = req.query.path;
    const abs = path.join(project.workdir, rel);
    if (!abs.startsWith(project.workdir)) return reply.code(400).send({ error: "bad path" });
    try {
      const stat = await fs.stat(abs);
      if (stat.size > 1_000_000) return reply.code(413).send({ error: "file too large" });
      const content = await fs.readFile(abs, "utf8");
      const dto: FileContentDto = { path: rel, content, size: stat.size, mtime: stat.mtimeMs };
      return dto;
    } catch (e: any) {
      return reply.code(500).send({ error: e.message });
    }
  });
};
```

- [ ] **Step 2: Write `apps/web/src/components/FileTree.vue`**

```vue
<script setup lang="ts">
import { ref, watch } from "vue";
import { NTree } from "naive-ui";
import { api } from "../api/client.js";
import type { FileNodeDto } from "@pi-web-ui/shared";

const props = defineProps<{ projectId: string }>();
const emit = defineEmits<{ (e: "select", path: string): void }>();

const treeData = ref<any[]>([]);

function toTree(nodes: FileNodeDto[]): any[] {
  return nodes.map((n) => ({
    key: n.path,
    label: n.name,
    isLeaf: n.type === "file",
    children: n.children ? toTree(n.children) : undefined,
  }));
}

async function load() {
  const list = await api.listFiles(props.projectId, "/");
  treeData.value = toTree(list);
}

watch(() => props.projectId, load, { immediate: true });
</script>

<template>
  <NTree :data="treeData" block-line @update:selected-keys="(keys: string[]) => keys[0] && emit('select', keys[0])" />
</template>
```

- [ ] **Step 3: Write `apps/web/src/components/FileViewer.vue`**

```vue
<script setup lang="ts">
import { ref, watch } from "vue";
import { NSpin } from "naive-ui";
import { api } from "../api/client.js";

const props = defineProps<{ projectId: string; path: string | null }>();
const content = ref<string>("");
const loading = ref(false);
const error = ref<string | null>(null);

watch(
  () => [props.projectId, props.path],
  async () => {
    if (!props.path) { content.value = ""; return; }
    loading.value = true; error.value = null;
    try {
      const r = await api.readFile(props.projectId, props.path);
      content.value = r.content;
    } catch (e: any) {
      error.value = e.message;
    } finally {
      loading.value = false;
    }
  },
  { immediate: true },
);
</script>

<template>
  <div class="file-viewer">
    <NSpin v-if="loading" />
    <pre v-else-if="!error" class="content">{{ content }}</pre>
    <div v-else class="error">{{ error }}</div>
  </div>
</template>

<style scoped>
.file-viewer { padding: 12px; height: 100%; overflow: auto; }
.content { background: #fafafa; padding: 12px; border-radius: 6px; font-family: ui-monospace, monospace; font-size: 13px; }
.error { color: #d03050; }
</style>
```

- [ ] **Step 4: Add `filesRoutes` to `app.ts` deps (no change needed; just register at startup later) and typecheck**

```bash
cd /Users/gengcc/Documents/project/pi-web-ui
pnpm --filter @pi-web-ui/server typecheck
pnpm --filter @pi-web-ui/web typecheck
```

Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/routes/files.ts apps/web/src/components
git commit -m "feat: file list/read routes and frontend file tree/viewer"
```

### Task 18: Project view and Home view

**Files:**
- Create: `apps/web/src/views/Home.vue`, `apps/web/src/views/Project.vue`, `apps/web/src/router/index.ts`
- Modify: `apps/web/src/App.vue`, `apps/web/src/main.ts`

- [ ] **Step 1: Write `apps/web/src/router/index.ts`**

```ts
import { createRouter, createWebHistory } from "vue-router";
import Home from "../views/Home.vue";
import Project from "../views/Project.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", component: Home },
    { path: "/projects/:id", component: Project, props: true },
  ],
});
```

- [ ] **Step 2: Write `apps/web/src/views/Home.vue`**

```vue
<script setup lang="ts">
import { onMounted, ref } from "vue";
import { NButton, NInput, NCard, NSpace, NSpin, NEmpty, useMessage } from "naive-ui";
import { useProjectStore } from "../stores/project.js";

const store = useProjectStore();
const message = useMessage();
const newName = ref("");

onMounted(() => store.loadAll());

async function create() {
  if (!newName.value.trim()) return;
  const p = await store.create(newName.value);
  message.success(`Created ${p.name}`);
  newName.value = "";
}
</script>

<template>
  <div class="home">
    <h1>Projects</h1>
    <NSpace>
      <NInput v-model:value="newName" placeholder="New project name" @keydown.enter="create" />
      <NButton type="primary" @click="create">Create</NButton>
    </NSpace>
    <NSpin v-if="store.loading" />
    <NEmpty v-else-if="!store.projects.length" description="No projects yet" />
    <div v-else class="grid">
      <NCard v-for="p in store.projects" :key="p.id" :title="p.name">
        <RouterLink :to="`/projects/${p.id}`">Open</RouterLink>
      </NCard>
    </div>
  </div>
</template>

<style scoped>
.home { padding: 24px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; margin-top: 16px; }
</style>
```

- [ ] **Step 3: Write `apps/web/src/views/Project.vue`**

```vue
<script setup lang="ts">
import { onMounted, ref } from "vue";
import { NLayout, NLayoutSider, NLayoutContent, NSelect, NEmpty, NButton } from "naive-ui";
import ChatPanel from "../components/ChatPanel.vue";
import FileTree from "../components/FileTree.vue";
import FileViewer from "../components/FileViewer.vue";
import { useProjectStore } from "../stores/project.js";
import { useSessionStore } from "../stores/session.js";

const props = defineProps<{ id: string }>();
const projectStore = useProjectStore();
const sessionStore = useSessionStore();
const filePath = ref<string | null>(null);
const sessionId = ref<string | null>(null);

onMounted(async () => {
  await projectStore.loadOne(props.id);
  await sessionStore.loadForProject(props.id);
  if (!sessionStore.sessions.length) {
    const s = await sessionStore.create(props.id);
    sessionId.value = s.id;
  } else {
    sessionId.value = sessionStore.sessions[0].id;
  }
  if (sessionId.value) await sessionStore.open(sessionId.value);
});

async function newSession() {
  if (!projectStore.current) return;
  const s = await sessionStore.create(projectStore.current.id);
  sessionId.value = s.id;
  await sessionStore.open(s.id);
}
</script>

<template>
  <NLayout class="root" has-sider>
    <NLayoutSider :width="200" bordered>
      <h3>{{ projectStore.current?.name ?? "..." }}</h3>
      <NButton size="small" @click="newSession">+ Session</NButton>
      <NSelect
        :value="sessionId"
        :options="sessionStore.sessions.map(s => ({ label: s.title ?? s.id.slice(0, 8), value: s.id }))"
        @update:value="(v: string) => { sessionId = v; sessionStore.open(v); }"
      />
    </NLayoutSider>
    <NLayoutSider :width="240" bordered>
      <FileTree :project-id="id" @select="(p) => filePath = p" />
    </NLayoutSider>
    <NLayoutContent class="content">
      <div class="chat-wrap">
        <ChatPanel v-if="sessionId" :session-id="sessionId" />
        <NEmpty v-else description="No session" />
      </div>
      <div class="file-wrap">
        <FileViewer :project-id="id" :path="filePath" />
      </div>
    </NLayoutContent>
  </NLayout>
</template>

<style scoped>
.root { height: 100vh; }
.content { display: flex; flex-direction: column; }
.chat-wrap { flex: 1 1 60%; min-height: 0; }
.file-wrap { flex: 0 0 40%; border-top: 1px solid #eee; min-height: 0; }
</style>
```

- [ ] **Step 4: Update `apps/web/src/App.vue` to include router and stores init**

```vue
<script setup lang="ts">
import { onMounted } from "vue";
import { NConfigProvider, NMessageProvider, NDialogProvider } from "naive-ui";
import { useConnectionStore } from "./stores/connection.js";
import { useAgentStore } from "./stores/agent.js";

const connection = useConnectionStore();
const agent = useAgentStore();
onMounted(() => { connection.init(); agent.init(); });
</script>

<template>
  <NConfigProvider>
    <NDialogProvider>
      <NMessageProvider>
        <RouterView />
      </NMessageProvider>
    </NDialogProvider>
  </NConfigProvider>
</template>
```

- [ ] **Step 5: Update `apps/web/src/main.ts` to install router**

```ts
import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { router } from "./router/index.js";

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount("#app");
```

- [ ] **Step 6: Typecheck**

```bash
cd /Users/gengcc/Documents/project/pi-web-ui
pnpm --filter @pi-web-ui/web typecheck
```

Expected: passes.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): home and project views with router"
```

---

## Phase 5: Resilience

### Task 19: Server startup wiring & crash recovery

**Files:**
- Modify: `apps/server/src/index.ts`
- Create: `apps/server/src/wiring.ts`

- [ ] **Step 1: Write `apps/server/src/wiring.ts`**

```ts
import { Config } from "./config.js";
import { openDatabase } from "./db/sqlite.js";
import { ProjectRepository } from "./db/repositories/project.js";
import { SessionRepository } from "./db/repositories/session.js";
import { MessageRepository } from "./db/repositories/message.js";
import { WorkdirManager } from "./workdir/manager.js";
import { ProcessManager } from "./agent/process-manager.js";
import { SessionStateStore } from "./agent/session-state.js";
import { buildApp } from "./app.js";
import { projectsRoutes } from "./routes/projects.js";
import { sessionsRoutes } from "./routes/sessions.js";
import { filesRoutes } from "./routes/files.js";
import { agentRoutes } from "./ws/agent.js";

export async function buildConfiguredApp(config: Config) {
  const db = openDatabase(config.dbPath);
  const workdirs = new WorkdirManager({ root: config.workdirRoot });
  const projects = new ProjectRepository(db);
  const sessions = new SessionRepository(db);
  // Mark any active sessions from a prior run as crashed
  sessions.markActiveAsCrashed();
  const messages = new MessageRepository(db);
  const processManager = new ProcessManager({ command: "npx", args: ["-y", "@earendil-works/pi-coding-agent", "--rpc"] });
  const sessionStates = new SessionStateStore();
  const app = await buildApp(config, { db, projects, sessions, messages, workdirs, processManager, sessionStates });
  await app.register(projectsRoutes, { prefix: "/api/projects" });
  await app.register(sessionsRoutes, { prefix: "/api" });
  await app.register(filesRoutes, { prefix: "/api" });
  await app.register(agentRoutes);
  return app;
}
```

- [ ] **Step 2: Update `apps/server/src/index.ts`**

```ts
import { loadConfig } from "./config.js";
import { buildConfiguredApp } from "./wiring.js";

const config = loadConfig();
const app = await buildConfiguredApp(config);
try {
  await app.listen({ port: config.port, host: config.host });
  app.log.info(`pi-web-ui server listening on http://${config.host}:${config.port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
```

- [ ] **Step 3: Typecheck and run server briefly to verify it boots**

```bash
cd /Users/gengcc/Documents/project/pi-web-ui
pnpm --filter @pi-web-ui/server typecheck
PI_WEB_UI_ROOT=/tmp/pi-web-boot PORT=5174 timeout 3 pnpm --filter @pi-web-ui/server dev || true
```

Expected: typecheck passes; server logs "listening" then exits on timeout.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/wiring.ts apps/server/src/index.ts
git commit -m "feat(server): startup wiring with crash recovery"
```

### Task 20: Idle/suspended timeout

**Files:**
- Modify: `apps/server/src/wiring.ts`
- Create: `apps/server/src/agent/idle-sweeper.ts`
- Test: `apps/server/tests/unit/idle-sweeper.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { IdleSweeper } from "../../src/agent/idle-sweeper.js";

describe("IdleSweeper", () => {
  it("marks a session idle after idleTimeout", async () => {
    vi.useFakeTimers();
    const onIdle = vi.fn();
    const onSuspend = vi.fn();
    const sweeper = new IdleSweeper({
      idleTimeoutMs: 1000,
      suspendedTimeoutMs: 2000,
      onIdle, onSuspend,
    });
    sweeper.track("s1", { lastActivityAt: Date.now() });
    vi.advanceTimersByTime(1500);
    expect(onIdle).toHaveBeenCalledWith("s1");
    vi.advanceTimersByTime(1000);
    expect(onSuspend).toHaveBeenCalledWith("s1");
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run, verify failure**

```bash
cd /Users/gengcc/Documents/project/pi-web-ui
pnpm --filter @pi-web-ui/server test -- idle-sweeper
```

Expected: FAIL

- [ ] **Step 3: Implement `apps/server/src/agent/idle-sweeper.ts`**

```ts
interface Tracked { lastActivityAt: number; interval?: ReturnType<typeof setInterval>; }

export interface IdleSweeperOptions {
  idleTimeoutMs: number;
  suspendedTimeoutMs: number;
  onIdle: (sessionId: string) => void;
  onSuspend: (sessionId: string) => void;
}

export class IdleSweeper {
  private tracked = new Map<string, { lastActivityAt: number; idleFired: boolean }>();
  private opts: IdleSweeperOptions;
  private timer?: ReturnType<typeof setInterval>;

  constructor(opts: IdleSweeperOptions) {
    this.opts = opts;
    this.timer = setInterval(() => this.tick(), 1000);
  }

  track(sessionId: string, opts: { lastActivityAt: number }) {
    this.tracked.set(sessionId, { lastActivityAt: opts.lastActivityAt, idleFired: false });
  }

  touch(sessionId: string) {
    const t = this.tracked.get(sessionId);
    if (t) { t.lastActivityAt = Date.now(); t.idleFired = false; }
  }

  untrack(sessionId: string) { this.tracked.delete(sessionId); }

  private tick() {
    const now = Date.now();
    for (const [id, t] of this.tracked) {
      const idleFor = now - t.lastActivityAt;
      if (!t.idleFired && idleFor >= this.opts.idleTimeoutMs) {
        t.idleFired = true;
        this.opts.onIdle(id);
      }
      if (idleFor >= this.opts.suspendedTimeoutMs) {
        this.opts.onSuspend(id);
        this.tracked.delete(id);
      }
    }
  }

  stop() { if (this.timer) clearInterval(this.timer); }
}
```

- [ ] **Step 4: Run, verify pass**

```bash
cd /Users/gengcc/Documents/project/pi-web-ui
pnpm --filter @pi-web-ui/server test -- idle-sweeper
```

Expected: 1 test passes.

- [ ] **Step 5: Wire it into `apps/server/src/wiring.ts`** — replace the file with:

```ts
import { Config } from "./config.js";
import { openDatabase } from "./db/sqlite.js";
import { ProjectRepository } from "./db/repositories/project.js";
import { SessionRepository } from "./db/repositories/session.js";
import { MessageRepository } from "./db/repositories/message.js";
import { WorkdirManager } from "./workdir/manager.js";
import { ProcessManager } from "./agent/process-manager.js";
import { SessionStateStore } from "./agent/session-state.js";
import { IdleSweeper } from "./agent/idle-sweeper.js";
import { buildApp } from "./app.js";
import { projectsRoutes } from "./routes/projects.js";
import { sessionsRoutes } from "./routes/sessions.js";
import { filesRoutes } from "./routes/files.js";
import { agentRoutes } from "./ws/agent.js";

export async function buildConfiguredApp(config: Config) {
  const db = openDatabase(config.dbPath);
  const workdirs = new WorkdirManager({ root: config.workdirRoot });
  const projects = new ProjectRepository(db);
  const sessions = new SessionRepository(db);
  sessions.markActiveAsCrashed();
  const messages = new MessageRepository(db);
  const processManager = new ProcessManager({ command: "npx", args: ["-y", "@earendil-works/pi-coding-agent", "--rpc"] });
  const sessionStates = new SessionStateStore();
  const app = await buildApp(config, { db, projects, sessions, messages, workdirs, processManager, sessionStates });

  const sweeper = new IdleSweeper({
    idleTimeoutMs: config.idleTimeoutMs,
    suspendedTimeoutMs: config.suspendedTimeoutMs,
    onIdle: (id) => sessions.setStatus(id, "idle"),
    onSuspend: (id) => {
      const state = sessionStates.get(id);
      if (state) { state.process.kill(); sessionStates.delete(id); }
      sessions.setStatus(id, "suspended");
    },
  });
  app.addHook("onClose", async () => sweeper.stop());

  await app.register(projectsRoutes, { prefix: "/api/projects" });
  await app.register(sessionsRoutes, { prefix: "/api" });
  await app.register(filesRoutes, { prefix: "/api" });
  await app.register(agentRoutes);

  return app;
}
```

- [ ] **Step 6: Run all server tests, verify pass**

```bash
cd /Users/gengcc/Documents/project/pi-web-ui
pnpm --filter @pi-web-ui/server test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/server
git commit -m "feat(server): idle/suspended sweeper"
```

---

## Phase 6: Polish

### Task 21: Status banner component

**Files:**
- Create: `apps/web/src/components/StatusBanner.vue`
- Modify: `apps/web/src/App.vue`

- [ ] **Step 1: Write `apps/web/src/components/StatusBanner.vue`**

```vue
<script setup lang="ts">
import { computed } from "vue";
import { NAlert } from "naive-ui";
import { useConnectionStore } from "../stores/connection.js";

const connection = useConnectionStore();
const message = computed(() => {
  if (connection.status === "connected") return null;
  if (connection.status === "connecting") return "Connecting...";
  return "Disconnected — retrying...";
});
const type = computed(() => (connection.status === "connecting" ? "info" : "warning"));
</script>

<template>
  <NAlert v-if="message" :type="type" closable :show-icon="false" class="banner">
    {{ message }}
  </NAlert>
</template>

<style scoped>
.banner { border-radius: 0; }
</style>
```

- [ ] **Step 2: Update `App.vue` to include the banner inside the providers**

Replace `apps/web/src/App.vue` with:

```vue
<script setup lang="ts">
import { onMounted } from "vue";
import { NConfigProvider, NMessageProvider, NDialogProvider } from "naive-ui";
import { useConnectionStore } from "./stores/connection.js";
import { useAgentStore } from "./stores/agent.js";
import StatusBanner from "./components/StatusBanner.vue";

const connection = useConnectionStore();
const agent = useAgentStore();
onMounted(() => { connection.init(); agent.init(); });
</script>

<template>
  <NConfigProvider>
    <NDialogProvider>
      <NMessageProvider>
        <StatusBanner />
        <RouterView />
      </NMessageProvider>
    </NDialogProvider>
  </NConfigProvider>
</template>
```

- [ ] **Step 3: Typecheck and commit**

```bash
cd /Users/gengcc/Documents/project/pi-web-ui
pnpm --filter @pi-web-ui/web typecheck
git add apps/web
git commit -m "feat(web): connection status banner"
```

### Task 22: End-to-end smoke test (manual)

- [ ] **Step 1: Run server in one terminal**

```bash
cd /Users/gengcc/Documents/project/pi-web-ui
pnpm dev
```

- [ ] **Step 2: Open http://localhost:5173, create a project, open it, type a message**

Expected: a session is created, message goes to pi-coding-agent (RPC mode), streamed back. (Real pi interaction requires a working `npx -y @earendil-works/pi-coding-agent --rpc` install; in MVP this may not be available — that's OK, the scaffolded flow is the verification.)

- [ ] **Step 3: Commit any leftover fixes**

```bash
git status
# if anything to commit:
git add -A
git commit -m "chore: end-to-end smoke fixes" || true
```

---

## Done

Run the full test suite as a final check:

```bash
pnpm typecheck
pnpm test
pnpm build
```

If everything passes, the MVP scaffold is complete. Next steps (out of plan): tree session UI, AGENTS.md editor, polished diff viewer, end-to-end Playwright tests, packaging.
