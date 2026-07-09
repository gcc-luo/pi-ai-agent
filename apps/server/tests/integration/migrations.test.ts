import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations.js";

describe("migrations", () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(":memory:"); });

  it("creates projects, sessions, messages tables", () => {
    runMigrations(db);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as any[];
    const names = tables.map((t) => t.name);
    expect(names).toContain("projects");
    expect(names).toContain("sessions");
    expect(names).toContain("messages");
  });

  it("is idempotent", () => {
    runMigrations(db);
    runMigrations(db);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as any[];
    const names = tables.map((t) => t.name);
    expect(names.filter((n) => n.startsWith("projects") || n.startsWith("sessions") || n.startsWith("messages")).length).toBe(3);
  });

  it("adds deleted_at column to projects", () => {
    runMigrations(db);
    const cols = db.prepare("PRAGMA table_info(projects)").all() as { name: string }[];
    expect(cols.map((c) => c.name)).toContain("deleted_at");
  });
});
