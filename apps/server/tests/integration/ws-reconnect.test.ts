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
import { ModelRepository } from "../../src/db/repositories/model.js";
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

function makeProcessManager(fakeProc: any) {
  return {
    start: async () => fakeProc,
    get: () => fakeProc,
  };
}

function waitForOpen(ws: WebSocket) {
  return new Promise<void>((r) => ws.on("open", () => r()));
}

function nextMessage(ws: WebSocket, timeoutMs = 500) {
  return new Promise<any>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    ws.once("message", (data) => {
      clearTimeout(t);
      resolve(JSON.parse(data.toString()));
    });
  });
}

describe("ws agent reconnect", () => {
  let tmp: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let port: number;
  let sessionId: string;
  let fakeProc: any;

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-wsreconnect-"));
    process.env.PI_WEB_UI_ROOT = tmp;
    const config = loadConfig();
    const db = openDatabase(config.dbPath);
    const projects = new ProjectRepository(db);
    const project = projects.create({ name: "p", workdir: tmp });
    const sessions = new SessionRepository(db);
    sessionId = sessions.create({ projectId: project.id }).id;

    fakeProc = makeFakeProc();
    const processManager = makeProcessManager(fakeProc);

    app = await buildApp(config, {
      db,
      projects,
      sessions,
      messages: new MessageRepository(db),
      models: new ModelRepository(db),
      sessionStates: new SessionStateStore(),
      processManager,
    });
    await app.register(agentRoutes);
    await app.listen({ port: 0, host: "127.0.0.1" });
    const addr = app.server.address();
    port = typeof addr === "object" && addr ? addr.port : 0;
  });

  afterEach(async () => {
    await app.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("delivers events to the second connection after reconnect", async () => {
    // Connection #1: send a prompt, get a response, disconnect.
    const ws1 = new WebSocket(`ws://127.0.0.1:${port}/ws/agent`);
    const ws1Received: any[] = [];
    ws1.on("message", (data) => ws1Received.push(JSON.parse(data.toString())));
    await waitForOpen(ws1);
    ws1.send(JSON.stringify({ type: "send", sessionId, content: "first" }));
    await new Promise((r) => setTimeout(r, 50));
    fakeProc.stdout.write(
      JSON.stringify({ type: "message_start", message: { role: "assistant", timestamp: 1000 } }) + "\n",
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(ws1Received.some((e) => e.type === "message_start")).toBe(true);
    ws1.close();
    await new Promise((r) => setTimeout(r, 50));

    // Connection #2: same session, new WebSocket. State already exists (proc alive),
    // so the if(!state) block is skipped and the old bridge is reused.
    const ws2 = new WebSocket(`ws://127.0.0.1:${port}/ws/agent`);
    const ws2Received: any[] = [];
    ws2.on("message", (data) => ws2Received.push(JSON.parse(data.toString())));
    await waitForOpen(ws2);
    ws2.send(JSON.stringify({ type: "send", sessionId, content: "second" }));
    await new Promise((r) => setTimeout(r, 50));

    // Pi (fake proc) emits response events on stdout. These must reach ws2.
    fakeProc.stdout.write(
      JSON.stringify({ type: "message_start", message: { role: "assistant", timestamp: 2000 } }) + "\n",
    );
    fakeProc.stdout.write(
      JSON.stringify({ type: "message_end", message: { role: "assistant", content: "reply", timestamp: 2000 } }) + "\n",
    );

    const msg = await nextMessage(ws2, 500);
    expect(msg.type).toBe("message_start");
    expect(ws2Received.some((e) => e.type === "message_end")).toBe(true);
    ws2.close();
  });
});
