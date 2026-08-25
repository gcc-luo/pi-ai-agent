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
  {
    name: "009_session_soft_delete",
    sql: `
      ALTER TABLE sessions ADD COLUMN deleted_at INTEGER;
      CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions(deleted_at) WHERE deleted_at IS NULL;
    `,
  },
  {
    name: "010_experts",
    sql: `
      CREATE TABLE experts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        icon TEXT NOT NULL DEFAULT '🤖',
        category TEXT NOT NULL,
        description TEXT NOT NULL,
        system_prompt TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        is_preset INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX idx_experts_category ON experts(category);
      CREATE INDEX idx_experts_preset ON experts(is_preset);
    `,
  },
  {
    name: "011_session_expert",
    sql: `
      ALTER TABLE sessions ADD COLUMN expert_id TEXT REFERENCES experts(id) ON DELETE SET NULL;
    `,
  },
  {
    name: "012_scheduled_tasks",
    sql: `
      CREATE TABLE scheduled_tasks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        cron_expression TEXT NOT NULL,
        task_type TEXT NOT NULL DEFAULT 'prompt',
        payload TEXT NOT NULL DEFAULT '{}',
        enabled INTEGER NOT NULL DEFAULT 1,
        last_run_at INTEGER,
        next_run_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE task_logs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'running',
        output TEXT NOT NULL DEFAULT '',
        started_at INTEGER NOT NULL,
        finished_at INTEGER
      );
      CREATE INDEX idx_task_logs_task ON task_logs(task_id);
    `,
  },
  {
    name: "013_task_session_link",
    sql: `
      ALTER TABLE scheduled_tasks ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL;
      ALTER TABLE task_logs ADD COLUMN session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL;
      CREATE INDEX idx_scheduled_tasks_project ON scheduled_tasks(project_id);
      CREATE INDEX idx_task_logs_session ON task_logs(session_id);
    `,
  },
  {
    name: "014_task_session_reuse",
    sql: `
      ALTER TABLE scheduled_tasks ADD COLUMN create_new_session INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE scheduled_tasks ADD COLUMN session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL;
    `,
  },
  {
    name: "015_channels",
    sql: `
      CREATE TABLE channels (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        config TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `,
  },
  {
    name: "016_wechat_conversations",
    sql: `
      CREATE TABLE wechat_conversations (
        channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (channel_id, user_id)
      );
      CREATE INDEX idx_wechat_conversations_session ON wechat_conversations(session_id);
    `,
  },
  {
    // Generalizes the earlier WeChat-only mapping so enterprise channels can
    // persist one Pi conversation per sender too.
    name: "017_channel_conversations",
    sql: `
      CREATE TABLE channel_conversations (
        channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (channel_id, user_id)
      );
      CREATE INDEX idx_channel_conversations_session ON channel_conversations(session_id);
      INSERT OR IGNORE INTO channel_conversations (channel_id, user_id, session_id, updated_at)
      SELECT channel_id, user_id, session_id, updated_at FROM wechat_conversations;
    `,
  },
  {
    name: "018_session_browser_capability",
    sql: `
      ALTER TABLE sessions ADD COLUMN browser_enabled INTEGER NOT NULL DEFAULT 0;
    `,
    safe: true, // ignore "duplicate column" errors for idempotency
  },
  {
    name: "019_plugin_system",
    sql: `
      CREATE TABLE plugin_settings (
        plugin_id TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 1,
        settings TEXT NOT NULL DEFAULT '{}',
        last_error TEXT,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE session_plugins (
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        plugin_id TEXT NOT NULL,
        selected_at INTEGER NOT NULL,
        PRIMARY KEY (session_id, plugin_id)
      );
      CREATE INDEX idx_session_plugins_session ON session_plugins(session_id);

      CREATE TABLE plugin_audit_logs (
        id TEXT PRIMARY KEY,
        plugin_id TEXT NOT NULL,
        session_id TEXT,
        action TEXT NOT NULL,
        risk TEXT NOT NULL,
        approved INTEGER NOT NULL,
        success INTEGER NOT NULL,
        details TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_plugin_audit_session ON plugin_audit_logs(session_id, created_at);

      INSERT OR IGNORE INTO session_plugins (session_id, plugin_id, selected_at)
      SELECT id, 'browser-use', updated_at FROM sessions WHERE browser_enabled = 1;
    `,
  },
  {
    name: "020_kb_reliability_multimodal",
    sql: `
      ALTER TABLE kb_files ADD COLUMN asset_kind TEXT NOT NULL DEFAULT 'document';
      ALTER TABLE kb_files ADD COLUMN active_revision_id TEXT;

      ALTER TABLE kb_chunks ADD COLUMN modality TEXT NOT NULL DEFAULT 'text';
      ALTER TABLE kb_chunks ADD COLUMN time_start_ms INTEGER;
      ALTER TABLE kb_chunks ADD COLUMN time_end_ms INTEGER;
      ALTER TABLE kb_chunks ADD COLUMN bbox_json TEXT;
      ALTER TABLE kb_chunks ADD COLUMN parent_chunk_id INTEGER REFERENCES kb_chunks(rowid) ON DELETE SET NULL;
      ALTER TABLE kb_chunks ADD COLUMN segment_uid TEXT;
      UPDATE kb_chunks
      SET segment_uid = file_id || ':' || generation || ':' || seq
      WHERE segment_uid IS NULL;
      CREATE UNIQUE INDEX idx_kb_chunks_segment_uid ON kb_chunks(segment_uid);

      CREATE TABLE kb_segment_vectors (
        chunk_id INTEGER NOT NULL REFERENCES kb_chunks(rowid) ON DELETE CASCADE,
        vector_space TEXT NOT NULL,
        modality TEXT NOT NULL,
        model_id TEXT NOT NULL,
        model_version TEXT NOT NULL,
        dimension INTEGER NOT NULL,
        embedding BLOB NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (chunk_id, vector_space, model_id, model_version)
      );
      CREATE INDEX idx_kb_segment_vectors_space
        ON kb_segment_vectors(vector_space, model_id, model_version, dimension);

      INSERT OR IGNORE INTO kb_segment_vectors (
        chunk_id, vector_space, modality, model_id, model_version,
        dimension, embedding, created_at
      )
      SELECT
        c.rowid, 'text', 'text', kb.embedding_model_id, 'legacy',
        length(c.embedding) / 4, c.embedding, c.created_at
      FROM kb_chunks c
      JOIN knowledge_bases kb ON kb.id = c.kb_id
      WHERE c.embedding IS NOT NULL AND kb.embedding_model_id IS NOT NULL;

      CREATE TABLE kb_asset_revisions (
        id TEXT PRIMARY KEY,
        file_id TEXT NOT NULL REFERENCES kb_files(id) ON DELETE CASCADE,
        generation INTEGER NOT NULL,
        status TEXT NOT NULL,
        parser_version TEXT NOT NULL,
        embedding_model_id TEXT,
        embedding_model_version TEXT,
        fail_reason TEXT,
        created_at INTEGER NOT NULL,
        completed_at INTEGER,
        UNIQUE(file_id, generation)
      );
      CREATE INDEX idx_kb_asset_revisions_file
        ON kb_asset_revisions(file_id, generation DESC);

      INSERT OR IGNORE INTO kb_asset_revisions (
        id, file_id, generation, status, parser_version, created_at, completed_at
      )
      SELECT 'legacy:' || f.id || ':' || f.parse_generation,
             f.id, f.parse_generation, 'ready', 'legacy',
             COALESCE(f.last_parsed_at, f.created_at), f.last_parsed_at
      FROM kb_files f
      WHERE f.parse_generation > 0;

      UPDATE kb_files
      SET active_revision_id = 'legacy:' || id || ':' || parse_generation
      WHERE parse_generation > 0;

      CREATE TABLE kb_parse_jobs (
        file_id TEXT PRIMARY KEY REFERENCES kb_files(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        available_at INTEGER NOT NULL,
        leased_at INTEGER,
        lease_expires_at INTEGER,
        last_error TEXT,
        rerun_requested INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX idx_kb_parse_jobs_ready
        ON kb_parse_jobs(status, available_at);

      DROP TABLE IF EXISTS kb_chunks_fts;
      CREATE VIRTUAL TABLE kb_chunks_fts USING fts5(
        content,
        content='kb_chunks',
        content_rowid='rowid',
        tokenize='unicode61 remove_diacritics 2'
      );

      INSERT OR IGNORE INTO kb_parse_jobs (
        file_id, status, attempts, max_attempts, available_at,
        leased_at, last_error, created_at, updated_at
      )
      SELECT f.id, 'queued', 0, 3, CAST(strftime('%s','now') AS INTEGER) * 1000,
             NULL, NULL, CAST(strftime('%s','now') AS INTEGER) * 1000,
             CAST(strftime('%s','now') AS INTEGER) * 1000
      FROM kb_files f
      JOIN knowledge_bases kb ON kb.id = f.kb_id
      WHERE f.status IN ('pending', 'parsing')
         OR kb.embedding_model_id IS NOT NULL;
    `,
  },
  {
    name: "021_connectors",
    sql: `
      CREATE TABLE connector_instances (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        icon TEXT NOT NULL DEFAULT '🔌',
        protocol TEXT NOT NULL DEFAULT 'mcp',
        scope_type TEXT NOT NULL,
        scope_id TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        lifecycle TEXT NOT NULL DEFAULT 'lazy',
        config_json TEXT NOT NULL,
        config_version INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_connected_at INTEGER,
        last_error_code TEXT,
        last_error TEXT
      );
      CREATE INDEX idx_connector_scope ON connector_instances(scope_type, scope_id);

      CREATE TABLE connector_credential_bindings (
        id TEXT PRIMARY KEY,
        connector_id TEXT NOT NULL REFERENCES connector_instances(id) ON DELETE CASCADE,
        field_path TEXT NOT NULL,
        credential_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(connector_id, field_path)
      );

      CREATE TABLE connector_tools (
        id TEXT PRIMARY KEY,
        connector_id TEXT NOT NULL REFERENCES connector_instances(id) ON DELETE CASCADE,
        tool_name TEXT NOT NULL,
        title TEXT,
        description TEXT,
        input_schema_json TEXT,
        output_schema_json TEXT,
        schema_hash TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        direct_tool INTEGER NOT NULL DEFAULT 0,
        risk_level TEXT NOT NULL DEFAULT 'unknown',
        discovered_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(connector_id, tool_name)
      );

      CREATE TABLE connector_tool_policies (
        id TEXT PRIMARY KEY,
        connector_id TEXT NOT NULL REFERENCES connector_instances(id) ON DELETE CASCADE,
        tool_name TEXT NOT NULL,
        scope_type TEXT NOT NULL DEFAULT 'connector',
        scope_id TEXT,
        policy TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(connector_id, tool_name, scope_type, scope_id)
      );

      CREATE TABLE connector_audits (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        workspace_id TEXT,
        connector_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        source TEXT,
        policy TEXT,
        approval TEXT,
        status TEXT NOT NULL,
        duration_ms INTEGER,
        error_code TEXT,
        argument_keys_json TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_connector_audit_created ON connector_audits(created_at DESC);
    `,
  },
  {
    name: "022_builtin_connectors",
    sql: `
      ALTER TABLE connector_instances ADD COLUMN builtin_key TEXT;
      CREATE UNIQUE INDEX idx_connector_builtin_key
        ON connector_instances(builtin_key) WHERE builtin_key IS NOT NULL;
    `,
  },
  {
    // Some databases recorded 020_kb_reliability_multimodal before its
    // segment_uid column was included. Keep the repair separate so a
    // duplicate-column safe migration cannot skip index/data backfilling.
    name: "023_kb_chunk_segment_uid",
    sql: `
      ALTER TABLE kb_chunks ADD COLUMN segment_uid TEXT;
    `,
    safe: true,
  },
  {
    name: "024_kb_chunk_segment_uid_index",
    sql: `
      UPDATE kb_chunks
      SET segment_uid = file_id || ':' || generation || ':' || seq
      WHERE segment_uid IS NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_kb_chunks_segment_uid
        ON kb_chunks(segment_uid);
    `,
  },
  {
    name: "025_kb_file_active_revision",
    sql: `
      ALTER TABLE kb_files ADD COLUMN active_revision_id TEXT;
    `,
    safe: true,
  },
  {
    name: "026_kb_file_active_revision_backfill",
    sql: `
      UPDATE kb_files
      SET active_revision_id = 'legacy:' || id || ':' || parse_generation
      WHERE active_revision_id IS NULL AND parse_generation > 0;
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
    } catch (e: any) {
      db.exec("ROLLBACK");
      if ((m as any).safe && e?.code === "SQLITE_ERROR") {
        // Migration marked safe — record it as applied even if the SQL failed
        // (e.g. "duplicate column" means the schema change already exists).
        insert.run(m.name, Date.now());
        continue;
      }
      throw e;
    }
  }
}
