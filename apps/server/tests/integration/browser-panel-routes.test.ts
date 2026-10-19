import Fastify from "fastify";
import websocket from "@fastify/websocket";
import WebSocket, { WebSocketServer } from "ws";
import { describe, expect, it, vi, type Mock } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildApp } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";
import { browserRoutes } from "../../src/routes/browser.js";
import { browserWsRoutes } from "../../src/ws/browser.js";

type FakeManager = {
  ensurePanelSession: Mock<[id: string], Promise<number>>;
  getPanelStreamPort: Mock<[id: string], number>;
  closePanelSession: Mock<[id: string], Promise<void>>;
  navigate: Mock<[id: string, url: string], Promise<void>>;
  back: Mock<[id: string], Promise<void>>;
  forward: Mock<[id: string], Promise<void>>;
  reload: Mock<[id: string], Promise<void>>;
};

async function fixture(ports: Record<string, number> = {}) {
  const app = Fastify({ logger: false });
  await app.register(websocket);
  const manager: FakeManager = {
    ensurePanelSession: vi.fn(async (id: string) => ports[id] ?? 42000),
    getPanelStreamPort: vi.fn((id: string) => ports[id] ?? 42000),
    closePanelSession: vi.fn(async (_id: string): Promise<void> => {}),
    navigate: vi.fn(async (_id: string, _url: string): Promise<void> => {}),
    back: vi.fn(async (_id: string): Promise<void> => {}),
    forward: vi.fn(async (_id: string): Promise<void> => {}),
    reload: vi.fn(async (_id: string): Promise<void> => {}),
  };
  app.decorate("sessions", { findById: (id: string) => id === "missing" ? null : ({ id, projectId: "project" }) } as never);
  app.decorate("browserManager", manager as never);
  app.decorate("pluginManager", { activeForSession: () => [] } as never);
  const revokePluginToken = vi.fn();
  const stopAndWait = vi.fn(async () => true);
  const cancelSession = vi.fn();
  app.decorate("processManager", { revokePluginToken, stopAndWait } as never);
  app.decorate("pluginPermissions", { cancelSession } as never);
  app.decorate("sessionStates", new Map() as never);
  app.decorate("plugins", { selectedForSession: () => [] } as never);
  await app.register(browserRoutes, { prefix: "/api" });
  await app.register(browserWsRoutes);
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { app, manager, port, revokePluginToken, stopAndWait, cancelSession };
}

async function startUpstream() {
  const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("upstream server did not bind a TCP port");
  return { server, port: address.port };
}

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
}

function waitForClose(socket: WebSocket): Promise<number> {
  return new Promise((resolve) => socket.once("close", (code) => resolve(code)));
}

function waitForMessage(socket: WebSocket): Promise<{ data: Buffer; binary: boolean }> {
  return new Promise((resolve) => socket.once("message", (data, binary) => {
    const buffer = Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
    resolve({ data: buffer, binary });
  }));
}

function waitForNoMessage(socket: WebSocket, timeoutMs = 100): Promise<boolean> {
  return new Promise((resolve) => {
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("message", onMessage);
    };
    const onMessage = () => { cleanup(); resolve(false); };
    const timer = setTimeout(() => { cleanup(); resolve(true); }, timeoutMs);
    socket.once("message", onMessage);
  });
}

async function closeServer(server: WebSocketServer) {
  for (const client of server.clients) client.terminate();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

describe("browser panel HTTP routes", () => {
  it("opens and controls the panel without changing Agent browser permissions", async () => {
    const f = await fixture();
    try {
      const open = await f.app.inject({ method: "POST", url: "/api/sessions/s/browser-panel/open" });
      const navigate = await f.app.inject({ method: "POST", url: "/api/sessions/s/browser-panel/navigate", payload: { url: "https://example.test/path" } });
      const back = await f.app.inject({ method: "POST", url: "/api/sessions/s/browser-panel/back" });
      const forward = await f.app.inject({ method: "POST", url: "/api/sessions/s/browser-panel/forward" });
      const reload = await f.app.inject({ method: "POST", url: "/api/sessions/s/browser-panel/reload" });
      const close = await f.app.inject({ method: "POST", url: "/api/sessions/s/browser-panel/close" });
      expect(open.statusCode).toBe(200);
      expect(navigate.statusCode).toBe(200);
      expect(back.statusCode).toBe(200);
      expect(forward.statusCode).toBe(200);
      expect(reload.statusCode).toBe(200);
      expect(close.statusCode).toBe(200);
      expect(f.manager.ensurePanelSession).toHaveBeenCalledWith("s");
      expect(f.manager.navigate).toHaveBeenCalledWith("s", "https://example.test/path");
      expect(f.manager.back).toHaveBeenCalledWith("s");
      expect(f.manager.forward).toHaveBeenCalledWith("s");
      expect(f.manager.reload).toHaveBeenCalledWith("s");
      expect(f.manager.closePanelSession).toHaveBeenCalledWith("s");
      expect(f.revokePluginToken).not.toHaveBeenCalled();
      expect(f.stopAndWait).not.toHaveBeenCalled();
      expect(f.cancelSession).not.toHaveBeenCalled();
    } finally {
      await f.app.close();
    }
  });

  it.each(["file:///tmp/x", "javascript:alert(1)", "ftp://example.test", "about:config"]) (
    "rejects navigation URL %s",
    async (url) => {
      const f = await fixture();
      try {
        const response = await f.app.inject({ method: "POST", url: "/api/sessions/s/browser-panel/navigate", payload: { url } });
        expect(response.statusCode).toBe(400);
        expect(f.manager.navigate).not.toHaveBeenCalled();
      } finally {
        await f.app.close();
      }
    },
  );

  it("accepts about:blank and rejects missing sessions on every panel operation", async () => {
    const f = await fixture();
    try {
      expect((await f.app.inject({ method: "POST", url: "/api/sessions/s/browser-panel/navigate", payload: { url: "about:blank" } })).statusCode).toBe(200);
      const paths = ["open", "close", "back", "forward", "reload", "navigate"];
      for (const action of paths) {
        const response = await f.app.inject({
          method: "POST",
          url: `/api/sessions/missing/browser-panel/${action}`,
          ...(action === "navigate" ? { payload: { url: "https://example.test" } } : {}),
        });
        expect(response.statusCode).toBe(404);
      }
    } finally {
      await f.app.close();
    }
  });
});

describe("browser panel WebSocket proxy", () => {
  it("waits for the shared stream before accepting the panel WebSocket", async () => {
    const upstream = await startUpstream();
    const f = await fixture({ s: upstream.port });
    let releaseStartup: ((port: number) => void) | undefined;
    f.manager.ensurePanelSession.mockImplementation(() => new Promise<number>((resolve) => {
      releaseStartup = resolve;
    }));
    const upstreamReady = new Promise<void>((resolve) => upstream.server.once("connection", () => resolve()));
    const client = new WebSocket(`ws://127.0.0.1:${f.port}/ws/browser/s`);
    let opened = false;
    client.once("open", () => { opened = true; });
    try {
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(opened).toBe(false);
      releaseStartup?.(upstream.port);
      await Promise.all([waitForOpen(client), upstreamReady]);
    } finally {
      releaseStartup?.(upstream.port);
      client.terminate();
      await f.app.close();
      await closeServer(upstream.server);
    }
  });

  it("keeps each session isolated and forwards text frames byte-for-byte both ways", async () => {
    const upstreamA = await startUpstream();
    const upstreamB = await startUpstream();
    let upstreamClientA: WebSocket | undefined;
    let upstreamClientB: WebSocket | undefined;
    const upstreamReadyA = new Promise<void>((resolve) => upstreamA.server.once("connection", (client) => { upstreamClientA = client; resolve(); }));
    const upstreamReadyB = new Promise<void>((resolve) => upstreamB.server.once("connection", (client) => { upstreamClientB = client; resolve(); }));
    const f = await fixture({ a: upstreamA.port, b: upstreamB.port });
    const clientA = new WebSocket(`ws://127.0.0.1:${f.port}/ws/browser/a`);
    const clientB = new WebSocket(`ws://127.0.0.1:${f.port}/ws/browser/b`);
    try {
      await Promise.all([waitForOpen(clientA), waitForOpen(clientB), upstreamReadyA, upstreamReadyB]);
      expect(upstreamClientA).toBeDefined();
      expect(upstreamClientB).toBeDefined();
      const rawServerFrame = '{ "type" : "status", "title" : "shared" }';
      const received = waitForMessage(clientA);
      upstreamClientA!.send(rawServerFrame);
      const frame = await received;
      expect(frame.data.toString()).toBe(rawServerFrame);
      expect(frame.binary).toBe(false);

      const noLeak = waitForNoMessage(upstreamClientB!);
      const clientInput = '{"type":"config","pacing":"ack","maxFps":10}';
      clientA.send(clientInput);
      await expect(noLeak).resolves.toBe(true);
      const toA = waitForMessage(upstreamClientA!);
      clientA.send(clientInput);
      expect((await toA).data.toString()).toBe(clientInput);
      clientA.close();
      await waitForClose(clientA);
      await waitForClose(upstreamClientA!);
      expect(clientA.listenerCount("message")).toBe(0);
      expect(upstreamClientA!.listenerCount("message")).toBe(0);
    } finally {
      clientA.terminate();
      clientB.terminate();
      await f.app.close();
      await closeServer(upstreamA.server);
      await closeServer(upstreamB.server);
    }
  });

  it("rejects WebSocket connections for missing sessions", async () => {
    const upstream = await startUpstream();
    const f = await fixture({ s: upstream.port });
    try {
      const socket = new WebSocket(`ws://127.0.0.1:${f.port}/ws/browser/missing`);
      const response = await new Promise<number>((resolve, reject) => {
        socket.once("unexpected-response", (_request, response) => resolve(response.statusCode ?? 0));
        socket.once("error", reject);
      });
      expect(response).toBe(404);
      expect(f.manager.ensurePanelSession).not.toHaveBeenCalled();
    } finally {
      await f.app.close();
      await closeServer(upstream.server);
    }
  });

  it("keeps deployment authentication on the new WebSocket route", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-browser-panel-auth-"));
    const config = { ...loadConfig(), host: "0.0.0.0", authToken: "secret-token", dbPath: path.join(root, "db.sqlite"), logFile: path.join(root, "server.log") };
    const app = await buildApp(config);
    app.decorate("sessions", { findById: () => ({ id: "s" }) } as never);
    app.decorate("browserManager", { ensurePanelSession: vi.fn(async () => 43000) } as never);
    await app.register(browserWsRoutes);
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    try {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/ws/browser/s`);
      const response = await new Promise<number>((resolve, reject) => {
        socket.once("unexpected-response", (_request, response) => resolve(response.statusCode ?? 0));
        socket.once("error", reject);
      });
      expect(response).toBe(401);
    } finally {
      await app.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("accepts only the documented mouse, keyboard, touch, config, and ack messages", async () => {
    const upstream = await startUpstream();
    let upstreamClient: WebSocket | undefined;
    const upstreamReady = new Promise<void>((resolve) => upstream.server.once("connection", (socket) => { upstreamClient = socket; resolve(); }));
    const f = await fixture({ s: upstream.port });
    const client = new WebSocket(`ws://127.0.0.1:${f.port}/ws/browser/s`);
    const messages = [
      '{"type":"input_mouse","eventType":"mousePressed","x":10,"y":12,"button":"left","clickCount":1}',
      '{"type":"input_keyboard","eventType":"keyDown","key":"a","text":"a"}',
      '{"type":"input_touch","eventType":"touchStart","touchPoints":[{"id":0,"x":10,"y":12,"force":0.5}]}',
      '{"type":"config","pacing":"ack","maxFps":10}',
      '{"type":"ack","seq":41}',
    ];
    try {
      await Promise.all([waitForOpen(client), upstreamReady]);
      for (const message of messages) {
        const forwarded = waitForMessage(upstreamClient!);
        client.send(message);
        expect((await forwarded).data.toString()).toBe(message);
      }
    } finally {
      client.terminate();
      await f.app.close();
      await closeServer(upstream.server);
    }
  });

  it.each([
    { name: "malformed JSON", payload: "{bad", code: 1008 },
    { name: "unknown message type", payload: JSON.stringify({ type: "eval", code: "1+1" }), code: 1008 },
    { name: "non-finite numeric value", payload: '{"type":"ack","seq":1e999}', code: 1008 },
    { name: "oversized text message", payload: "x".repeat(65 * 1024), code: 1009 },
    { name: "binary message", payload: Buffer.from('{"type":"ack","seq":1}'), binary: true, code: 1008 },
  ])("closes on $name", async ({ payload, binary, code }) => {
    const upstream = await startUpstream();
    const f = await fixture({ s: upstream.port });
    let upstreamClient: WebSocket | undefined;
    const upstreamReady = new Promise<void>((resolve) => upstream.server.once("connection", (socket) => { upstreamClient = socket; resolve(); }));
    const client = new WebSocket(`ws://127.0.0.1:${f.port}/ws/browser/s`);
    try {
      await Promise.all([waitForOpen(client), upstreamReady]);
      const upstreamClosed = waitForClose(upstreamClient!);
      const closed = waitForClose(client);
      client.send(payload, { binary: binary ?? false });
      await expect(closed).resolves.toBe(code);
      await upstreamClosed;
      expect(upstreamClient?.readyState).not.toBe(WebSocket.OPEN);
    } finally {
      client.terminate();
      await f.app.close();
      await closeServer(upstream.server);
    }
  });
});
