import Fastify from "fastify";
import websocket from "@fastify/websocket";
import WebSocket from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IPty } from "node-pty";
import { TerminalSessionManager } from "../../src/terminal/terminal-session-manager.js";
import { terminalWsRoutes } from "../../src/ws/terminal.js";

class FakePty {
  writes: string[] = [];
  resizes: Array<[number, number]> = [];
  kills = 0;
  dataHandlers: Array<(data: string) => void> = [];
  exitHandlers: Array<(event: { exitCode: number; signal?: number }) => void> = [];
  write(data: string) { this.writes.push(data); }
  resize(cols: number, rows: number) { this.resizes.push([cols, rows]); }
  kill() { this.kills += 1; }
  onData(handler: (data: string) => void) { this.dataHandlers.push(handler); return { dispose: () => undefined }; }
  onExit(handler: (event: { exitCode: number; signal?: number }) => void) { this.exitHandlers.push(handler); return { dispose: () => undefined }; }
  emitData(data: string) { this.dataHandlers.forEach((handler) => handler(data)); }
  emitExit(exitCode: number, signal?: number) { this.exitHandlers.forEach((handler) => handler({ exitCode, signal })); }
}

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
}

function waitForMessage(socket: WebSocket): Promise<{ data: Buffer; binary: boolean }> {
  return new Promise((resolve) => socket.once("message", (data, binary) => {
    const buffer = Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
    resolve({ data: buffer, binary });
  }));
}

function waitForClose(socket: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => socket.once("close", (code, reason) => resolve({ code, reason: reason.toString() })));
}

async function fixture() {
  const app = Fastify({ logger: false });
  await app.register(websocket);
  const processes: FakePty[] = [];
  const manager = new TerminalSessionManager({
    logger: app.log,
    platform: "linux",
    env: { SHELL: "/bin/sh" },
    spawn: vi.fn(() => {
      const pty = new FakePty();
      processes.push(pty);
      return pty as unknown as IPty;
    }),
  });
  app.decorate("sessions", {
    findById: (id: string) => id === "missing" ? null : { id, projectId: id === "orphan" ? "missing-project" : "project" },
  } as never);
  app.decorate("projects", {
    findById: (id: string) => id === "project" ? { id, workdir: "/server/project-root" } : null,
  } as never);
  app.decorate("terminalManager", manager as never);
  await app.register(terminalWsRoutes);
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { app, manager, processes, url: `ws://127.0.0.1:${port}/ws/terminal/session` };
}

describe("terminal panel WebSocket", () => {
  const apps: ReturnType<typeof Fastify>[] = [];
  afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

  it("supports an idempotent local HTTP close fallback", async () => {
    const f = await fixture();
    apps.push(f.app);
    await f.manager.ensure("session", "/server/project-root");
    const first = await f.app.inject({ method: "POST", url: "/api/sessions/session/terminal/close" });
    const second = await f.app.inject({ method: "POST", url: "/api/sessions/session/terminal/close" });
    const foreignOrigin = await f.app.inject({
      method: "POST",
      url: "/api/sessions/session/terminal/close",
      headers: { origin: "https://evil.example" },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ status: "closed" });
    expect(second.statusCode).toBe(200);
    expect(foreignOrigin.statusCode).toBe(403);
    expect(f.processes[0]!.kills).toBe(1);
  });

  it("uses the session's project workdir and forwards input, resize, and binary output", async () => {
    const f = await fixture();
    apps.push(f.app);
    const socket = new WebSocket(f.url);
    await waitForOpen(socket);
    expect(f.processes).toHaveLength(1);

    const inputPromise = waitForMessage(socket);
    f.processes[0]!.emitData("hello\r\n");
    const output = await inputPromise;
    expect(output).toEqual({ data: Buffer.from("hello\r\n"), binary: true });

    socket.send(JSON.stringify({ type: "input", data: "pwd\r" }));
    socket.send(JSON.stringify({ type: "resize", cols: 120, rows: 45 }));
    await vi.waitFor(() => {
      expect(f.processes[0]!.writes).toEqual(["pwd\r"]);
      expect(f.processes[0]!.resizes).toEqual([[120, 45]]);
    });
    socket.close();
    await new Promise<void>((resolve) => socket.once("close", () => resolve()));
    expect(f.processes[0]!.kills).toBe(0);
  });

  it("replays buffered output before streaming new PTY data after reconnect", async () => {
    const f = await fixture();
    apps.push(f.app);
    await f.manager.ensure("session", "/server/project-root");
    f.processes[0]!.emitData("before reconnect\r\n");

    const socket = new WebSocket(f.url);
    const replay = waitForMessage(socket);
    await waitForOpen(socket);
    expect((await replay).data.toString()).toBe("before reconnect\r\n");
    const next = waitForMessage(socket);
    f.processes[0]!.emitData("after reconnect\r\n");
    expect((await next).data.toString()).toBe("after reconnect\r\n");
    socket.close();
    await new Promise<void>((resolve) => socket.once("close", () => resolve()));
    expect(f.processes).toHaveLength(1);
  });

  it("rejects invalid origins and missing session or project before starting a PTY", async () => {
    const f = await fixture();
    apps.push(f.app);
    const rejected = async (url: string, origin?: string) => {
      const socket = new WebSocket(url, { headers: origin ? { Origin: origin } : {} });
      const response = await new Promise<number>((resolve, reject) => {
        socket.once("unexpected-response", (_request, response) => resolve(response.statusCode ?? 0));
        socket.once("error", reject);
      });
      return response;
    };
    expect(await rejected(f.url, "https://evil.example")).toBe(403);
    const base = f.url.replace("/session", "");
    expect(await rejected(`${base}/missing`)).toBe(404);
    expect(await rejected(`${base}/orphan`)).toBe(404);
    expect(f.processes).toHaveLength(0);
  });

  it("kills only on an explicit close message and reports PTY exit", async () => {
    const f = await fixture();
    apps.push(f.app);
    const socket = new WebSocket(f.url);
    await waitForOpen(socket);
    const exitPromise = waitForMessage(socket);
    f.processes[0]!.emitExit(23, 9);
    expect((await exitPromise).data.toString()).toBe(JSON.stringify({ type: "exit", exitCode: 23, signal: 9 }));

    socket.send(JSON.stringify({ type: "close" }));
    const closed = await waitForClose(socket);
    expect(closed.code).toBe(1000);
    expect(f.processes[0]!.kills).toBe(0);

    const second = new WebSocket(f.url);
    await waitForOpen(second);
    second.send(JSON.stringify({ type: "close" }));
    await waitForClose(second);
    expect(f.processes[1]!.kills).toBe(1);
  });

  it("terminates attached sockets on server-side close and starts a fresh PTY on reopen", async () => {
    const f = await fixture();
    apps.push(f.app);
    const first = new WebSocket(f.url);
    await waitForOpen(first);

    const serverClose = waitForClose(first);
    await f.manager.close("session");
    expect((await serverClose).code).toBe(1001);
    expect(f.processes[0]!.kills).toBe(1);

    const reopened = new WebSocket(f.url);
    await waitForOpen(reopened);
    expect(f.processes).toHaveLength(2);
    reopened.close();
    await waitForClose(reopened);
  });

  it("closes malformed, oversized, and out-of-range messages without killing the PTY", async () => {
    const f = await fixture();
    apps.push(f.app);
    const socket = new WebSocket(f.url);
    await waitForOpen(socket);
    const closed = waitForClose(socket);
    socket.send(JSON.stringify({ type: "resize", cols: 1, rows: 24 }));
    expect((await closed).code).toBe(1008);
    expect(f.processes[0]!.kills).toBe(0);

    const oversized = new WebSocket(f.url);
    await waitForOpen(oversized);
    const oversizedClosed = waitForClose(oversized);
    oversized.send(JSON.stringify({ type: "input", data: "x".repeat(8 * 1024 + 1) }));
    expect((await oversizedClosed).code).toBe(1009);
    expect(f.processes[0]!.writes).toEqual([]);
  });
});
