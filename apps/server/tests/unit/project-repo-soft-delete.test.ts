import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations.js";
import { ProjectRepository } from "../../src/db/repositories/project.js";

describe("ProjectRepository soft delete", () => {
  let db: Database.Database;
  let repo: ProjectRepository;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    repo = new ProjectRepository(db);
  });

  it("list() excludes soft-deleted projects", () => {
    const a = repo.create({ name: "a", workdir: "/tmp/a" });
    repo.create({ name: "b", workdir: "/tmp/b" });
    repo.delete(a.id);
    const names = repo.list().map((p) => p.name);
    expect(names).toEqual(["b"]);
  });

  it("findById() returns null for a soft-deleted project", () => {
    const p = repo.create({ name: "a", workdir: "/tmp/a" });
    repo.delete(p.id);
    expect(repo.findById(p.id)).toBeNull();
  });

  it("delete() sets deleted_at instead of removing the row", () => {
    const p = repo.create({ name: "a", workdir: "/tmp/a" });
    repo.delete(p.id);
    const row = db.prepare("SELECT deleted_at FROM projects WHERE id = ?").get(p.id) as { deleted_at: number | null } | undefined;
    expect(row).toBeDefined();
    expect(row!.deleted_at).not.toBeNull();
  });

  it("delete() on a missing id is a no-op (no throw)", () => {
    expect(() => repo.delete("does-not-exist")).not.toThrow();
  });
});
