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
    expect(names).toContain("connector_instances");
    expect(names).toContain("connector_tools");
    expect(names).toContain("connector_audits");
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

  it("repairs legacy databases missing knowledge-base columns", () => {
    db.exec(`
      CREATE TABLE _migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);
      CREATE TABLE kb_files (
        id TEXT PRIMARY KEY,
        parse_generation INTEGER NOT NULL,
        last_parsed_at INTEGER,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE kb_chunks (
        rowid INTEGER PRIMARY KEY AUTOINCREMENT,
        file_id TEXT NOT NULL,
        generation INTEGER NOT NULL,
        seq INTEGER NOT NULL
      );
      INSERT INTO kb_files (id, parse_generation, created_at) VALUES ('file-1', 2, 0);
      INSERT INTO kb_chunks (file_id, generation, seq) VALUES ('file-1', 2, 3);
      INSERT INTO _migrations (name, applied_at) VALUES
        ('001_initial', 0), ('002_models', 0), ('003_project_soft_delete', 0),
        ('004_model_type', 0), ('005_knowledge_base', 0),
        ('006_kb_embedding_model', 0), ('007_kb_chunk_embedding', 0),
        ('008_kb_fts_rebuild', 0), ('009_session_soft_delete', 0),
        ('010_experts', 0), ('011_session_expert', 0),
        ('012_scheduled_tasks', 0), ('013_task_session_link', 0),
        ('014_task_session_reuse', 0), ('015_channels', 0),
        ('016_wechat_conversations', 0), ('017_channel_conversations', 0),
        ('018_session_browser_capability', 0), ('019_plugin_system', 0),
        ('020_kb_reliability_multimodal', 0), ('021_connectors', 0),
        ('022_builtin_connectors', 0);
    `);

    runMigrations(db);

    const row = db.prepare("SELECT segment_uid FROM kb_chunks WHERE rowid = 1").get() as { segment_uid: string };
    expect(row.segment_uid).toBe("file-1:2:3");
    const file = db.prepare("SELECT active_revision_id FROM kb_files WHERE id = 'file-1'").get() as { active_revision_id: string };
    expect(file.active_revision_id).toBe("legacy:file-1:2");
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_kb_chunks_segment_uid'").get()).toBeTruthy();
  });

  it("adds built-in connector identity without storing credentials", () => {
    runMigrations(db);
    const columns = db.prepare("PRAGMA table_info(connector_instances)").all() as { name: string }[];
    expect(columns.map((column) => column.name)).toContain("builtin_key");
    expect(columns.map((column) => column.name)).not.toContain("token");
  });
});
