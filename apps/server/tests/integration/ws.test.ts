import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import WebSocket from "ws";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import type Database from "better-sqlite3";
import { buildApp } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";
import { openDatabase } from "../../src/db/sqlite.js";
import { ProjectRepository } from "../../src/db/repositories/project.js";
import { SessionRepository } from "../../src/db/repositories/session.js";
import { MessageRepository } from "../../src/db/repositories/message.js";
import { NotificationRepository } from "../../src/db/repositories/notification.js";
import { ModelRepository } from "../../src/db/repositories/model.js";
import { ProcessManager } from "../../src/agent/process-manager.js";
import { SessionStateStore } from "../../src/agent/session-state.js";
import { agentRoutes } from "../../src/ws/agent.js";

function makeFakeProc() {
  const proc: any = new EventEmitter();
  proc.stdin = new PassThrough();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.pid = 1;
  proc.kill = () => proc.emit("exit", null);
  return proc;
}

async function waitFor(condition: () => boolean, timeoutMs = 2_000): Promise<void> {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt >= timeoutMs) throw new Error("timed out waiting for WebSocket event");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe("ws agent", () => {
  let tmp: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let port: number;
  let sessionId: string;
  let spawnArgs: string[][];
  let db: Database.Database;

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-ws-"));
    process.env.PI_WEB_UI_ROOT = tmp;
    const config = loadConfig();
    db = openDatabase(config.dbPath);
    const projects = new ProjectRepository(db);
    const workdir = path.join(tmp, "workdir");
    fs.mkdirSync(workdir);
    const project = projects.create({ name: "p", workdir });
    const sessions = new SessionRepository(db);
    sessionId = sessions.create({ projectId: project.id }).id;

    spawnArgs = [];
    const processManager = new ProcessManager({
      spawn: (_command, args) => {
        spawnArgs.push(args);
        return makeFakeProc() as any;
      },
      command: "pi",
      args: [],
      logger: { info() {}, warn() {}, error() {} } as any,
    });

    app = await buildApp(config, {
      db, projects, sessions, messages: new MessageRepository(db),
      notifications: new NotificationRepository(db),
      models: new ModelRepository(db),
      processManager, sessionStates: new SessionStateStore(),
      kbBindings: { listBySession: () => [] },
      experts: { findById: () => null },
    });
    await app.register(agentRoutes);
    await app.listen({ port: 0, host: "127.0.0.1" });
    const addr = app.server.address();
    port = typeof addr === "object" && addr ? addr.port : 0;
  });
  afterEach(async () => {
    await app.close();
    db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("sends a message and receives echoed events", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/agent`);
    const received: any[] = [];
    ws.on("message", (data) => received.push(JSON.parse(data.toString())));
    await new Promise<void>((r) => ws.on("open", () => r()));
    ws.send(JSON.stringify({ type: "send", sessionId, content: "hi" }));
    await new Promise((r) => setTimeout(r, 100));
    const stdout = ((app as any).processManager.get(sessionId) as any).stdout as PassThrough;
    stdout.write(JSON.stringify({
      type: "message_start",
      message: { role: "assistant", timestamp: 1 },
    }) + "\n");
    stdout.write(JSON.stringify({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "hello" },
    }) + "\n");
    await new Promise((r) => setTimeout(r, 100));
    ws.close();
    const types = received.map((e) => e.type);
    expect(types).toContain("message_start");
    expect(types).toContain("message_delta");
  });

  it("rejects a second prompt while the current agent run is working", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/agent`);
    const received: any[] = [];
    ws.on("message", (data) => received.push(JSON.parse(data.toString())));
    await new Promise<void>((resolve) => ws.on("open", resolve));

    ws.send(JSON.stringify({ type: "send", sessionId, content: "first" }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    ws.send(JSON.stringify({ type: "send", sessionId, content: "second" }));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(received).toContainEqual(expect.objectContaining({
      type: "error",
      sessionId,
      code: "agent_busy",
      message: "模型仍在处理上一条消息，请等待完成后再发送。",
    }));
    expect(app.messages.listBySession(sessionId).map((message) => message.content)).toEqual(["first"]);
    ws.close();
  });

  it("sends clean user text and compacts idle context without persisting a user turn", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/agent`);
    const received: any[] = [];
    ws.on("message", (data) => received.push(JSON.parse(data.toString())));
    await new Promise<void>((resolve) => ws.on("open", resolve));
    ws.send(JSON.stringify({ type: "send", sessionId, content: "hello" }));
    await waitFor(() => !!app.sessionStates.get(sessionId));
    const proc = app.processManager.get(sessionId)!;
    const initial = proc.stdin as PassThrough;
    const commands = initial.read().toString().trim().split("\n").map((line: string) => JSON.parse(line));
    expect(commands.find((c: any) => c.type === "prompt").message).toBe("hello");
    ws.send(JSON.stringify({ type: "compact", sessionId }));
    await waitFor(() => received.some((e) => e.code === "compaction_busy"));
    proc.stdout.emit("data", JSON.stringify({ type: "agent_settled" }) + "\n");
    await waitFor(() => app.sessionStates.get(sessionId)?.runStatus === "idle");
    await waitFor(() => received.some((event) => event.type === "agent_task_settled"));
    expect(received).toContainEqual(expect.objectContaining({
      type: "agent_task_settled",
      sessionId,
      status: "completed",
      unreadCount: 1,
    }));
    ws.send(JSON.stringify({ type: "compact", sessionId }));
    await waitFor(() => initial.readableLength > 0);
    expect(initial.read().toString()).toBe(JSON.stringify({ type: "compact" }) + "\n");
    proc.stdout.emit("data", JSON.stringify({ type: "response", command: "compact", success: true }) + "\n");
    await waitFor(() => app.sessionStates.get(sessionId)?.runStatus === "idle");
    expect(app.messages.listBySession(sessionId).map((m) => m.content)).toEqual(["hello"]);
    ws.close();
  });

  it("persists the stable client message ID together with image metadata", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/agent`);
    await new Promise<void>((resolve) => ws.on("open", resolve));

    ws.send(JSON.stringify({
      type: "send",
      sessionId,
      clientMessageId: "local-u1",
      content: "检查截图",
      images: [{ name: "shot.png", mediaType: "image/png", data: "abc" }],
    }));

    await waitFor(() => app.messages.listBySession(sessionId).length === 1);
    expect(app.messages.listBySession(sessionId)[0]?.metadata).toEqual({
      clientMessageId: "local-u1",
      images: [{ name: "shot.png", mediaType: "image/png", data: "abc" }],
    });
    ws.close();
  });

  it("starts and restarts the session with the model selected by the client", async () => {
    app.models.create({
      id: "model-a",
      label: "Model A",
      provider: "openai",
      modelType: "text",
      apiKey: "key-a",
      isDefault: true,
    });
    app.models.create({
      id: "model-b",
      label: "Model B",
      provider: "openai",
      modelType: "multimodal",
      apiKey: "key-b",
    });

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/agent`);
    const received: any[] = [];
    ws.on("message", (data) => received.push(JSON.parse(data.toString())));
    await new Promise<void>((resolve) => ws.on("open", resolve));

    ws.send(JSON.stringify({
      type: "send",
      sessionId,
      content: "describe",
      model: "model-b",
    }));
    await waitFor(() => spawnArgs.length >= 1);
    expect(spawnArgs[0]).toEqual(expect.arrayContaining(["--provider", "openai", "--model", "model-b"]));

    ws.send(JSON.stringify({
      type: "switchModel",
      sessionId,
      model: "model-a",
    }));
    await waitFor(() => spawnArgs.length >= 2);

    expect(spawnArgs[1]).toEqual(expect.arrayContaining(["--provider", "openai", "--model", "model-a"]));
    await waitFor(() => received.some((event) => event.type === "model_changed"));
    expect(received).toContainEqual(expect.objectContaining({
      type: "model_changed",
      sessionId,
      provider: "openai",
      model: "model-a",
    }));
    ws.close();
  });
});
