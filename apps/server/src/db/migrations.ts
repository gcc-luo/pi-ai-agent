import type Database from "better-sqlite3";

const MIGRATIONS = [
  {
    name: "001_initial",
    sql: `
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        workdir TEXT NOT NULL UNIQUE,
        description TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT,
        parent_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'active',
        pi_session_ref TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_active_at INTEGER
      );
      CREATE INDEX idx_sessions_project ON sessions(project_id);
      CREATE INDEX idx_sessions_parent ON sessions(parent_id);

      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        seq INTEGER NOT NULL
      );
      CREATE INDEX idx_messages_session_seq ON messages(session_id, seq);
    `,
  },
  {
    name: "002_models",
    sql: `
      CREATE TABLE models (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        provider TEXT NOT NULL,
        api_base_url TEXT,
        api_key TEXT,
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `,
  },
];

export function runMigrations(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);`);
  const applied = new Set(
    (db.prepare("SELECT name FROM _migrations").all() as { name: string }[]).map((r) => r.name),
  );
  const insert = db.prepare("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)");
  for (const m of MIGRATIONS) {
    if (applied.has(m.name)) continue;
    db.exec("BEGIN");
    try {
      db.exec(m.sql);
      insert.run(m.name, Date.now());
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
}
