import { beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations.js";
import { PluginRepository } from "../../src/db/repositories/plugin.js";
import { ProjectRepository } from "../../src/db/repositories/project.js";
import { SessionRepository } from "../../src/db/repositories/session.js";

describe("PluginRepository", () => {
  let db: Database.Database;
  let plugins: PluginRepository;
  let sessionId: string;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    plugins = new PluginRepository(db);
    const projects = new ProjectRepository(db);
    const sessions = new SessionRepository(db);
    const project = projects.create({ name: "p", workdir: "/tmp/p" });
    sessionId = sessions.create({ projectId: project.id }).id;
    plugins.ensure("browser-use", true);
    plugins.ensure("computer-use", true);
  });

  it("persists global settings and isolated session selections", () => {
    plugins.setSelectedForSession(sessionId, ["browser-use", "computer-use"]);
    expect(plugins.selectedForSession(sessionId)).toEqual(["browser-use", "computer-use"]);

    plugins.update("computer-use", { enabled: false, settings: { mode: "safe" } });
    expect(plugins.find("computer-use")).toMatchObject({
      enabled: false,
      settings: { mode: "safe" },
    });
  });

  it("mirrors Browser Use selection to the legacy session field", () => {
    plugins.setSelectedForSession(sessionId, ["browser-use"]);
    const session = new SessionRepository(db).findById(sessionId)!;
    expect(session.selectedPluginIds).toEqual(["browser-use"]);
    expect(session.browserEnabled).toBe(true);

    plugins.setSelectedForSession(sessionId, []);
    expect(new SessionRepository(db).findById(sessionId)?.browserEnabled).toBe(false);
  });

  it("records execution audits", () => {
    plugins.appendAudit({
      pluginId: "computer-use",
      sessionId,
      action: "key",
      risk: "destructive",
      approved: false,
      success: false,
      details: { reason: "Alt+F4" },
    });
    const row = db.prepare("SELECT * FROM plugin_audit_logs").get() as {
      plugin_id: string;
      risk: string;
      approved: number;
    };
    expect(row).toMatchObject({
      plugin_id: "computer-use",
      risk: "destructive",
      approved: 0,
    });
  });
});
