import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import Fastify from "fastify";
import { BrowserSessionManager } from "../../src/browser/browser-session-manager.js";
import { runMigrations } from "../../src/db/migrations.js";
import { PluginRepository } from "../../src/db/repositories/plugin.js";
import { ProjectRepository } from "../../src/db/repositories/project.js";
import { SessionRepository } from "../../src/db/repositories/session.js";
import { PluginManager } from "../../src/plugins/plugin-manager.js";

describe("PluginManager", () => {
  let repository: PluginRepository;
  let manager: PluginManager;
  let sessionId: string;
  let browser: { runtimeStatus: () => { status: string; error: null }; close: ReturnType<typeof vi.fn>; closeSession: ReturnType<typeof vi.fn>; closeAll: ReturnType<typeof vi.fn>; shutdown: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    const db = new Database(":memory:");
    runMigrations(db);
    repository = new PluginRepository(db);
    const projects = new ProjectRepository(db);
    const sessions = new SessionRepository(db);
    sessionId = sessions.create({
      projectId: projects.create({ name: "p", workdir: "/tmp/p" }).id,
    }).id;
    browser = {
      runtimeStatus: () => ({ status: "enabled", error: null }),
      close: vi.fn(),
      closeSession: vi.fn(),
      closeAll: vi.fn(),
      shutdown: vi.fn(),
    };
    const computer = {
      runtimeStatus: () => ({ status: "enabled", error: null }),
      closeSession: vi.fn(),
      shutdown: vi.fn(),
    };
    manager = new PluginManager(repository, browser as never, computer as never);
  });

  it("discovers the two official built-in plugins", () => {
    expect(manager.list()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "browser-use", builtin: true, official: true }),
      expect.objectContaining({ id: "computer-use", builtin: true, official: true }),
    ]));
  });

  it("exposes only globally enabled plugins selected by the session", () => {
    manager.setSessionPlugins(sessionId, ["browser-use", "computer-use"]);
    expect(manager.activeForSession(sessionId)).toEqual(["browser-use", "computer-use"]);

    manager.setEnabled("computer-use", false);
    expect(manager.activeForSession(sessionId)).toEqual(["browser-use"]);
  });

  it("forwards terminal tombstone options to browser session cleanup", async () => {
    await manager.closeSession(sessionId, { retainTombstone: true });
    expect(browser.closeSession).toHaveBeenCalledWith(sessionId, { retainTombstone: true });
  });

  it("closes active browser resources on plugin disable without permanently shutting down the manager", async () => {
    await manager.disableRuntime("browser-use");

    expect(browser.closeAll).toHaveBeenCalledOnce();
    expect(browser.shutdown).not.toHaveBeenCalled();
  });

  it("reopens the browser panel after globally disabling and re-enabling Browser Use", async () => {
    const sessionRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pi-plugin-browser-"));
    const browserManager = new BrowserSessionManager({
      logger: Fastify({ logger: false }).log,
      sessionRoot,
      runCommand: async (_file, args) => {
        if (args.includes("list")) return { stdout: JSON.stringify({ tabs: [{ tabId: "t1" }] }), stderr: "" };
        if (args.includes("stream") && args.includes("status")) return { stdout: JSON.stringify({ enabled: true, port: 44111 }), stderr: "" };
        return { stdout: "{}", stderr: "" };
      },
    });
    const computer = {
      runtimeStatus: () => ({ status: "enabled", error: null }),
      closeSession: vi.fn(),
      shutdown: vi.fn(),
    };
    const pluginManager = new PluginManager(repository, browserManager, computer as never);
    try {
      pluginManager.setSessionPlugins(sessionId, ["browser-use"]);
      await expect(browserManager.ensurePanelSession(sessionId)).resolves.toBe(44111);

      pluginManager.setEnabled("browser-use", false);
      await pluginManager.disableRuntime("browser-use");
      expect(pluginManager.activeForSession(sessionId)).toEqual([]);

      pluginManager.setEnabled("browser-use", true);
      expect(pluginManager.activeForSession(sessionId)).toEqual(["browser-use"]);
      await expect(browserManager.ensurePanelSession(sessionId)).resolves.toBe(44111);
    } finally {
      await browserManager.shutdown();
      await fs.rm(sessionRoot, { recursive: true, force: true });
    }
  });
});
