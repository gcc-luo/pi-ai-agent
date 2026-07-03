import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations.js";
import { ProjectRepository } from "../../src/db/repositories/project.js";

describe("ProjectRepository", () => {
  let db: Database.Database;
  let repo: ProjectRepository;
  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    repo = new ProjectRepository(db);
  });

  it("creates and finds a project", () => {
    const p = repo.create({ name: "demo", workdir: "/tmp/demo" });
    expect(p.id).toBeDefined();
    const found = repo.findById(p.id);
    expect(found?.name).toBe("demo");
  });

  it("lists all projects", () => {
    repo.create({ name: "a", workdir: "/tmp/a" });
    repo.create({ name: "b", workdir: "/tmp/b" });
    expect(repo.list().map((p) => p.name).sort()).toEqual(["a", "b"]);
  });

  it("updates a project", () => {
    const p = repo.create({ name: "demo", workdir: "/tmp/demo" });
    repo.update(p.id, { name: "renamed" });
    expect(repo.findById(p.id)?.name).toBe("renamed");
  });

  it("deletes a project", () => {
    const p = repo.create({ name: "demo", workdir: "/tmp/demo" });
    repo.delete(p.id);
    expect(repo.findById(p.id)).toBeNull();
  });
});
