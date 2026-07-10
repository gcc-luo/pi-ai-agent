import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations.js";
import { ProjectRepository } from "../../src/db/repositories/project.js";
import { SessionRepository } from "../../src/db/repositories/session.js";

describe("SessionRepository", () => {
  let db: Database.Database;
  let projects: ProjectRepository;
  let sessions: SessionRepository;
  let projectId: string;
  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    projects = new ProjectRepository(db);
    sessions = new SessionRepository(db);
    projectId = projects.create({ name: "p", workdir: "/tmp/p" }).id;
  });

  it("creates a session", () => {
    const s = sessions.create({ projectId });
    expect(s.projectId).toBe(projectId);
    expect(s.status).toBe("active");
  });

  it("supports a parent session (tree)", () => {
    const parent = sessions.create({ projectId });
    const child = sessions.create({ projectId, parentId: parent.id });
    expect(child.parentId).toBe(parent.id);
    expect(sessions.children(parent.id).map((c) => c.id)).toContain(child.id);
  });

  it("lists by project", () => {
    sessions.create({ projectId });
    sessions.create({ projectId });
    expect(sessions.listByProject(projectId).length).toBe(2);
  });

  it("updates status and last_active_at", () => {
    const s = sessions.create({ projectId });
    sessions.touch(s.id, "idle");
    expect(sessions.findById(s.id)?.status).toBe("idle");
  });

  it("updates title and bumps updated_at", () => {
    const s = sessions.create({ projectId, title: "old" });
    const before = sessions.findById(s.id)!;
    sessions.update(s.id, { title: "new-title" });
    const after = sessions.findById(s.id)!;
    expect(after.title).toBe("new-title");
    expect(after.updatedAt).toBeGreaterThanOrEqual(before.updatedAt);
  });

  it("update throws on unknown id", () => {
    expect(() => sessions.update("nope", { title: "x" })).toThrow();
  });
});
