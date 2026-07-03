import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import WebSocket from "ws";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
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
    await new Promise<void>((r) => ws.on("open", () => r()));
    ws.send(JSON.stringify({ type: "send", sessionId, content: "hi" }));
    await new Promise((r) => setTimeout(r, 100));
    const stdout = ((app as any).processManager.get(sessionId) as any).stdout as PassThrough;
    stdout.write(JSON.stringify({ type: "message_start", sessionId, messageId: "m1", role: "assistant" }) + "\n");
    stdout.write(JSON.stringify({ type: "message_delta", sessionId, messageId: "m1", delta: "hello" }) + "\n");
    await new Promise((r) => setTimeout(r, 100));
    ws.close();
    const types = received.map((e) => e.type);
    expect(types).toContain("message_start");
    expect(types).toContain("message_delta");
  });
});
