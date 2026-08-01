import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations.js";
import { ProjectRepository } from "../../src/db/repositories/project.js";
import { SessionRepository } from "../../src/db/repositories/session.js";

const DAY = 24 * 60 * 60 * 1000;

function setDeletedAt(db: Database.Database, table: string, id: string, ts: number) {
  db.prepare(`UPDATE ${table} SET deleted_at = ? WHERE id = ?`).run(ts, id);
}

describe("trash retention purge", () => {
  let db: Database.Database;
  let projects: ProjectRepository;
  let sessions: SessionRepository;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    projects = new ProjectRepository(db);
    sessions = new SessionRepository(db);
  });

  it("purges projects older than the cutoff, cascades to their sessions", () => {
    const old = projects.create({ name: "old", workdir: "/tmp/old" });
    const oldSession = sessions.create({ projectId: old.id, title: "s" });
    const fresh = projects.create({ name: "fresh", workdir: "/tmp/fresh" });

    projects.delete(old.id);
    projects.delete(fresh.id);
    const now = Date.now();
    setDeletedAt(db, "projects", old.id, now - 31 * DAY);
    setDeletedAt(db, "projects", fresh.id, now - 1 * DAY);

    const purged = projects.purgeDeletedOlderThan(now - 30 * DAY);
    expect(purged).toEqual([old.id]);
    expect(projects.listDeleted().map((p) => p.id)).toEqual([fresh.id]);
    // cascading permanent delete removed the old project's session row too
    expect(sessions.listDeleted().find((s) => s.id === oldSession.id)).toBeUndefined();
  });

  it("purges sessions older than the cutoff only", () => {
    const p = projects.create({ name: "p", workdir: "/tmp/p" });
    const oldS = sessions.create({ projectId: p.id, title: "old" });
    const newS = sessions.create({ projectId: p.id, title: "new" });

    sessions.delete(oldS.id);
    sessions.delete(newS.id);
    const now = Date.now();
    setDeletedAt(db, "sessions", oldS.id, now - 40 * DAY);
    setDeletedAt(db, "sessions", newS.id, now - 2 * DAY);

    const purged = sessions.purgeDeletedOlderThan(now - 30 * DAY);
    expect(purged).toEqual([oldS.id]);
    expect(sessions.listDeleted().map((s) => s.id)).toEqual([newS.id]);
  });

  it("returns empty array when nothing is expired", () => {
    const p = projects.create({ name: "p", workdir: "/tmp/p" });
    projects.delete(p.id);
    expect(projects.purgeDeletedOlderThan(Date.now() - 30 * DAY)).toEqual([]);
    // still in trash
    expect(projects.listDeleted().map((x) => x.id)).toEqual([p.id]);
  });
});
