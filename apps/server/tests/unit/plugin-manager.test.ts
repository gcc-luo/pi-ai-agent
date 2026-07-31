import { beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations.js";
import { PluginRepository } from "../../src/db/repositories/plugin.js";
import { ProjectRepository } from "../../src/db/repositories/project.js";
import { SessionRepository } from "../../src/db/repositories/session.js";
import { PluginManager } from "../../src/plugins/plugin-manager.js";

describe("PluginManager", () => {
  let repository: PluginRepository;
  let manager: PluginManager;
  let sessionId: string;

  beforeEach(() => {
    const db = new Database(":memory:");
    runMigrations(db);
    repository = new PluginRepository(db);
    const projects = new ProjectRepository(db);
    const sessions = new SessionRepository(db);
    sessionId = sessions.create({
      projectId: projects.create({ name: "p", workdir: "/tmp/p" }).id,
    }).id;
    const browser = {
      runtimeStatus: () => ({ status: "enabled", error: null }),
      close: vi.fn(),
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
});
