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
    expect(names).toContain("plugin_settings");
    expect(names).toContain("session_plugins");
    expect(names).toContain("plugin_audit_logs");
    expect(names).toContain("kb_asset_revisions");
    expect(names).toContain("kb_segment_vectors");
    expect(names).toContain("kb_parse_jobs");
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

  it("adds the active revision pointer and multimodal segment columns", () => {
    runMigrations(db);
    const fileColumns = db.prepare("PRAGMA table_info(kb_files)").all() as { name: string }[];
    const chunkColumns = db.prepare("PRAGMA table_info(kb_chunks)").all() as { name: string }[];
    expect(fileColumns.map((column) => column.name)).toContain("active_revision_id");
    expect(chunkColumns.map((column) => column.name)).toEqual(expect.arrayContaining([
      "segment_uid", "modality", "time_start_ms", "time_end_ms", "bbox_json",
    ]));
  });
});
