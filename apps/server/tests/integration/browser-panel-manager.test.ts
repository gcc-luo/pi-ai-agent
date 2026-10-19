import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { BrowserSessionManager } from "../../src/browser/browser-session-manager.js";
import { browserIdentity } from "../../src/browser/browser-runtime.js";

describe("browser panel session manager", () => {
  it("reuses the session browser identity and leaves its existing page open", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-browser-panel-"));
    const calls: { args: string[]; env: NodeJS.ProcessEnv }[] = [];
    const runCommand = vi.fn(async (_file: string, args: string[], options: { env?: NodeJS.ProcessEnv }) => {
      calls.push({ args, env: options.env ?? {} });
      if (args.includes("list")) return { stdout: JSON.stringify({ tabs: [{ tabId: "t1", url: "https://agent.test/" }] }), stderr: "" };
      if (args.includes("stream") && args.includes("status")) return { stdout: JSON.stringify({ enabled: true, port: 43123 }), stderr: "" };
      return { stdout: "{}", stderr: "" };
    });
    const manager = new BrowserSessionManager({ logger: Fastify({ logger: false }).log, sessionRoot: root, runCommand } as never);
    try {
      await expect(manager.ensurePanelSession("session-a")).resolves.toBe(43123);
      expect(calls.some(({ args }) => args[0] === "open")).toBe(false);
      const expected = browserIdentity(root, "session-a");
      expect(calls[0]?.args).toEqual(["--namespace", expected.namespace, "--session", expected.session, "tab", "list", "--json"]);
      expect(calls.every(({ args, env }) => args[1] === expected.namespace && args[3] === expected.session
        && env.AGENT_BROWSER_SESSION === expected.session
        && env.AGENT_BROWSER_NAMESPACE === expected.namespace)).toBe(true);
      expect(manager.getPanelStreamPort("session-a")).toBe(43123);
    } finally {
      await manager.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("opens a blank page only when no tab exists and enables the stream using its reported port", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-browser-panel-"));
    const calls: string[][] = [];
    let streamEnabled = false;
    const runCommand = vi.fn(async (_file: string, args: string[]) => {
      calls.push(args);
      if (args.includes("list")) return { stdout: JSON.stringify({ tabs: [] }), stderr: "" };
      if (args.includes("stream") && args.includes("status")) return { stdout: JSON.stringify({ enabled: streamEnabled, port: streamEnabled ? 45189 : null }), stderr: "" };
      if (args.includes("stream") && args.includes("enable")) streamEnabled = true;
      return { stdout: "{}", stderr: "" };
    });
    const manager = new BrowserSessionManager({ logger: Fastify({ logger: false }).log, sessionRoot: root, runCommand } as never);
    try {
      await expect(manager.ensurePanelSession("session-b")).resolves.toBe(45189);
      expect(calls.map((args) => args.slice(4)).filter((args) => args[0] === "open")).toEqual([["open", "about:blank"]]);
      expect(calls.map((args) => args.slice(4))).toContainEqual(["stream", "enable"]);
      expect(calls.filter((args) => args.includes("stream") && args.includes("status"))).toHaveLength(2);
    } finally {
      await manager.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("navigates and closes the panel stream without closing the shared browser session", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-browser-panel-"));
    const calls: string[][] = [];
    const runCommand = vi.fn(async (_file: string, args: string[]) => {
      calls.push(args);
      if (args.includes("list")) return { stdout: JSON.stringify({ tabs: [{ tabId: "t1" }] }), stderr: "" };
      if (args.includes("stream") && args.includes("status")) return { stdout: JSON.stringify({ enabled: true, port: 44001 }), stderr: "" };
      return { stdout: "{}", stderr: "" };
    });
    const manager = new BrowserSessionManager({ logger: Fastify({ logger: false }).log, sessionRoot: root, runCommand } as never);
    try {
      await manager.navigate("session-c", "https://example.test/path");
      await manager.back("session-c");
      await manager.forward("session-c");
      await manager.reload("session-c");
      await manager.closePanelSession("session-c");
      expect(calls.map((args) => args.slice(4))).toContainEqual(["open", "https://example.test/path"]);
      expect(calls.map((args) => args.slice(4))).toContainEqual(["back"]);
      expect(calls.map((args) => args.slice(4))).toContainEqual(["forward"]);
      expect(calls.map((args) => args.slice(4))).toContainEqual(["reload"]);
      expect(calls.map((args) => args.slice(4))).toContainEqual(["stream", "disable"]);
      expect(calls.some((args) => args[4] === "close")).toBe(false);
      expect(manager.getPanelStreamPort("session-c")).toBeNull();
    } finally {
      await manager.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("closes panel-only browser resources during session manager shutdown", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-browser-panel-"));
    const calls: string[][] = [];
    const runCommand = vi.fn(async (_file: string, args: string[]) => {
      calls.push(args);
      if (args.includes("list")) return { stdout: JSON.stringify({ tabs: [{ tabId: "t1" }] }), stderr: "" };
      if (args.includes("stream") && args.includes("status")) return { stdout: JSON.stringify({ enabled: true, port: 44102 }), stderr: "" };
      return { stdout: "{}", stderr: "" };
    });
    const manager = new BrowserSessionManager({ logger: Fastify({ logger: false }).log, sessionRoot: root, runCommand } as never);
    try {
      await manager.ensurePanelSession("session-d");
      await manager.shutdown();
      expect(calls.map((args) => args.slice(4))).toContainEqual(["stream", "disable"]);
      expect(calls.map((args) => args.slice(4))).toContainEqual(["close"]);
      expect(manager.getPanelStreamPort("session-d")).toBeNull();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("keeps daemon cleanup tracking after panel close and reuses the shared page on reopen", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-browser-panel-"));
    const calls: string[][] = [];
    const runCommand = vi.fn(async (_file: string, args: string[]) => {
      calls.push(args);
      if (args.includes("list")) return { stdout: JSON.stringify({ tabs: [{ tabId: "t1", url: "https://agent.test/" }] }), stderr: "" };
      if (args.includes("stream") && args.includes("status")) return { stdout: JSON.stringify({ enabled: true, port: 44103 }), stderr: "" };
      return { stdout: "{}", stderr: "" };
    });
    const manager = new BrowserSessionManager({ logger: Fastify({ logger: false }).log, sessionRoot: root, runCommand } as never);
    try {
      await manager.ensurePanelSession("session-reopen");
      await manager.closePanelSession("session-reopen");
      expect(manager.getPanelStreamPort("session-reopen")).toBeNull();
      expect(calls.some((args) => args[4] === "close")).toBe(false);

      await manager.ensurePanelSession("session-reopen");
      expect(calls.filter((args) => args[4] === "tab" && args[5] === "list")).toHaveLength(2);
      expect(calls.filter((args) => args[4] === "open")).toHaveLength(0);
      expect(manager.getPanelStreamPort("session-reopen")).toBe(44103);
      await manager.closePanelSession("session-reopen");

      await manager.shutdown();
      expect(calls.some((args) => args[4] === "close")).toBe(true);
      expect(manager.getPanelStreamPort("session-reopen")).toBeNull();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("closes a tracked daemon when its session is deleted after the panel closed", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-browser-panel-"));
    const calls: string[][] = [];
    const runCommand = vi.fn(async (_file: string, args: string[]) => {
      calls.push(args);
      if (args.includes("list")) return { stdout: JSON.stringify({ tabs: [{ tabId: "t1" }] }), stderr: "" };
      if (args.includes("stream") && args.includes("status")) return { stdout: JSON.stringify({ enabled: true, port: 44104 }), stderr: "" };
      return { stdout: "{}", stderr: "" };
    });
    const manager = new BrowserSessionManager({ logger: Fastify({ logger: false }).log, sessionRoot: root, runCommand } as never);
    try {
      await manager.ensurePanelSession("session-deleted");
      await manager.closePanelSession("session-deleted");
      await manager.close("session-deleted");
      expect(calls.some((args) => args[4] === "close")).toBe(true);
      expect(manager.getPanelStreamPort("session-deleted")).toBeNull();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("serializes first startup with session close and refuses an ensure after closing starts", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-browser-panel-"));
    const calls: string[][] = [];
    let releaseTabList: (() => void) | undefined;
    let markTabListStarted: (() => void) | undefined;
    const tabListStarted = new Promise<void>((resolve) => { markTabListStarted = resolve; });
    const waitForTabList = new Promise<void>((resolve) => { releaseTabList = resolve; });
    const runCommand = vi.fn(async (_file: string, args: string[]) => {
      calls.push(args);
      if (args.includes("list")) {
        markTabListStarted?.();
        await waitForTabList;
        return { stdout: JSON.stringify({ tabs: [] }), stderr: "" };
      }
      if (args.includes("stream") && args.includes("status")) return { stdout: JSON.stringify({ enabled: true, port: 44105 }), stderr: "" };
      return { stdout: "{}", stderr: "" };
    });
    const manager = new BrowserSessionManager({ logger: Fastify({ logger: false }).log, sessionRoot: root, runCommand } as never);
    try {
      const startup = manager.ensurePanelSession("session-race");
      await tabListStarted;
      const closing = manager.closeSession("session-race", { retainTombstone: true });
      const lateStartup = manager.ensurePanelSession("session-race");
      releaseTabList?.();
      await expect(startup).resolves.toBe(44105);
      await closing;
      await expect(lateStartup).rejects.toThrow(/closing/i);

      expect(calls.map((args) => args[4]).at(-1)).toBe("close");
      expect(manager.getPanelStreamPort("session-race")).toBeNull();
      await expect(manager.ensurePanelSession("session-race")).rejects.toThrow(/closing/i);
      expect(calls.filter((args) => args[4] === "open")).toHaveLength(1);
      expect(calls.filter((args) => args[4] === "close")).toHaveLength(1);
      await manager.shutdown();
      expect(calls.filter((args) => args[4] === "close")).toHaveLength(1);
    } finally {
      releaseTabList?.();
      await manager.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("allows an explicitly restored session to start its panel again", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-browser-panel-"));
    const calls: string[][] = [];
    const runCommand = vi.fn(async (_file: string, args: string[]) => {
      calls.push(args);
      if (args.includes("list")) return { stdout: JSON.stringify({ tabs: [{ tabId: "t1" }] }), stderr: "" };
      if (args.includes("stream") && args.includes("status")) return { stdout: JSON.stringify({ enabled: true, port: 44106 }), stderr: "" };
      return { stdout: "{}", stderr: "" };
    });
    const manager = new BrowserSessionManager({ logger: Fastify({ logger: false }).log, sessionRoot: root, runCommand } as never);
    try {
      await manager.closeSession("session-restored", { retainTombstone: true });
      await expect(manager.ensurePanelSession("session-restored")).rejects.toThrow(/closing/i);
      await manager.resumeSession("session-restored");
      await expect(manager.ensurePanelSession("session-restored")).resolves.toBe(44106);
      expect(calls.filter((args) => args[4] === "tab" && args[5] === "list")).toHaveLength(1);
    } finally {
      await manager.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("does not retain a closing tombstone for an ordinary browser close", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-browser-panel-"));
    const calls: string[][] = [];
    const runCommand = vi.fn(async (_file: string, args: string[]) => {
      calls.push(args);
      if (args.includes("list")) return { stdout: JSON.stringify({ tabs: [{ tabId: "t1" }] }), stderr: "" };
      if (args.includes("stream") && args.includes("status")) return { stdout: JSON.stringify({ enabled: true, port: 44107 }), stderr: "" };
      return { stdout: "{}", stderr: "" };
    });
    const manager = new BrowserSessionManager({ logger: Fastify({ logger: false }).log, sessionRoot: root, runCommand } as never);
    try {
      await manager.ensurePanelSession("session-ordinary-close");
      await manager.close("session-ordinary-close");
      await expect(manager.ensurePanelSession("session-ordinary-close")).resolves.toBe(44107);
      expect(calls.filter((args) => args[4] === "close")).toHaveLength(1);
      await manager.close("session-ordinary-close");
    } finally {
      await manager.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
