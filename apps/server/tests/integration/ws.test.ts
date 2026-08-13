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

    expect(received).toContainEqual({
      type: "error",
      sessionId,
      code: "agent_busy",
      message: "模型仍在处理上一条消息，请等待完成后再发送。",
    });
    expect(app.messages.listBySession(sessionId).map((message) => message.content)).toEqual(["first"]);
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
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(spawnArgs[0]).toEqual(expect.arrayContaining(["--provider", "openai", "--model", "model-b"]));

    ws.send(JSON.stringify({
      type: "switchModel",
      sessionId,
      model: "model-a",
    }));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(spawnArgs[1]).toEqual(expect.arrayContaining(["--provider", "openai", "--model", "model-a"]));
    expect(received).toContainEqual({
      type: "model_changed",
      sessionId,
      provider: "openai",
      model: "model-a",
    });
    ws.close();
  });
});
