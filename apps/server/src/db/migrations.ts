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
  {
    name: "003_project_soft_delete",
    sql: `
      ALTER TABLE projects ADD COLUMN deleted_at INTEGER;
      CREATE INDEX IF NOT EXISTS idx_projects_active ON projects(deleted_at) WHERE deleted_at IS NULL;
    `,
  },
  {
    name: "004_model_type",
    sql: `
      ALTER TABLE models ADD COLUMN model_type TEXT NOT NULL DEFAULT 'text';
    `,
  },
  {
    name: "005_knowledge_base",
    sql: `
      CREATE TABLE knowledge_bases (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        description TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE kb_files (
        id TEXT PRIMARY KEY,
        kb_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        ext TEXT NOT NULL,
        source TEXT NOT NULL,
        size INTEGER NOT NULL,
        storage_path TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        enabled INTEGER NOT NULL DEFAULT 1,
        parse_generation INTEGER NOT NULL DEFAULT 0,
        fail_reason TEXT,
        char_count INTEGER,
        page_count INTEGER,
        chunk_count INTEGER,
        last_parsed_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(kb_id, name)
      );
      CREATE INDEX idx_kb_files_kb ON kb_files(kb_id);
      CREATE INDEX idx_kb_files_status ON kb_files(status);

      CREATE TABLE kb_chunks (
        rowid INTEGER PRIMARY KEY AUTOINCREMENT,
        kb_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
        file_id TEXT NOT NULL REFERENCES kb_files(id) ON DELETE CASCADE,
        generation INTEGER NOT NULL,
        seq INTEGER NOT NULL,
        title_path TEXT,
        page_start INTEGER,
        page_end INTEGER,
        content TEXT NOT NULL,
        char_count INTEGER,
        created_at INTEGER NOT NULL,
        UNIQUE(file_id, generation, seq)
      );
      CREATE INDEX idx_kb_chunks_file_gen ON kb_chunks(file_id, generation);
      CREATE INDEX idx_kb_chunks_kb ON kb_chunks(kb_id);

      CREATE VIRTUAL TABLE kb_chunks_fts USING fts5(
        content,
        content='kb_chunks',
        content_rowid='rowid',
        tokenize='unicode61 remove_diacritics 2'
      );

      CREATE TABLE session_kb_bindings (
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        kb_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
        enabled INTEGER NOT NULL DEFAULT 1,
        file_filter TEXT,
        bound_at INTEGER NOT NULL,
        PRIMARY KEY (session_id, kb_id)
      );
      CREATE INDEX idx_session_kb_bindings_session ON session_kb_bindings(session_id);
    `,
  },
  {
    name: "006_kb_embedding_model",
    sql: `
      ALTER TABLE knowledge_bases ADD COLUMN embedding_model_id TEXT REFERENCES models(id) ON DELETE SET NULL;
    `,
  },
  {
    name: "007_kb_chunk_embedding",
    sql: `
      ALTER TABLE kb_chunks ADD COLUMN embedding BLOB;
    `,
  },
  {
    // Fix: unicode61 groups consecutive CJK chars into one token (e.g. "夏日炎炎蝉声噪"
    // becomes a single token). Drop and recreate the FTS index — the application startup
    // code rebuilds it with per-character CJK tokenization via tokenizeForFts().
    name: "008_kb_fts_rebuild",
    sql: `
      DROP TABLE IF EXISTS kb_chunks_fts;
      CREATE VIRTUAL TABLE kb_chunks_fts USING fts5(
        content,
        content='kb_chunks',
        content_rowid='rowid',
        tokenize='unicode61 remove_diacritics 2'
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
