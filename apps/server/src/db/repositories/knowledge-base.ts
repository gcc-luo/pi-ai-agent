import type Database from "better-sqlite3";
import { KbDto } from "@pi-web-ui/shared";
import { ulid } from "../../util/ulid.js";

type Row = {
  id: string; name: string; description: string | null;
  enabled: number; embedding_model_id: string | null;
  created_at: number; updated_at: number;
};

type StatsRow = {
  fileCount: number; searchableFileCount: number;
  failedFileCount: number; chunkCount: number;
};

function toDto(r: Row, stats: StatsRow): KbDto {
  return {
    id: r.id, name: r.name, description: r.description,
    enabled: r.enabled === 1,
    embeddingModelId: r.embedding_model_id,
    createdAt: r.created_at, updatedAt: r.updated_at,
    fileCount: stats.fileCount, searchableFileCount: stats.searchableFileCount,
    failedFileCount: stats.failedFileCount, chunkCount: stats.chunkCount,
  };
}

export class KnowledgeBaseRepository {
  constructor(private db: Database.Database) {}

  create(input: { name: string; description?: string; embeddingModelId?: string | null }): KbDto {
    const id = ulid();
    const now = Date.now();
    this.db.prepare(
      "INSERT INTO knowledge_bases (id, name, description, embedding_model_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(id, input.name, input.description ?? null, input.embeddingModelId ?? null, now, now);
    return {
      id, name: input.name, description: input.description ?? null,
      enabled: true, embeddingModelId: input.embeddingModelId ?? null,
      createdAt: now, updatedAt: now,
      fileCount: 0, searchableFileCount: 0, failedFileCount: 0, chunkCount: 0,
    };
  }

  findById(id: string): KbDto | null {
    const r = this.db.prepare("SELECT * FROM knowledge_bases WHERE id = ?").get(id) as Row | undefined;
    if (!r) return null;
    return toDto(r, this.getStats(id));
  }

  private getStats(kbId: string): StatsRow {
    return this.db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM kb_files WHERE kb_id = ?) AS fileCount,
        (SELECT COUNT(*) FROM kb_files WHERE kb_id = ? AND status = 'ready' AND enabled = 1 AND parse_generation > 0) AS searchableFileCount,
        (SELECT COUNT(*) FROM kb_files WHERE kb_id = ? AND status = 'failed') AS failedFileCount,
        (SELECT COUNT(*) FROM kb_chunks c
         JOIN kb_files f ON f.id = c.file_id
         WHERE c.kb_id = ? AND c.generation = f.parse_generation) AS chunkCount
    `).get(kbId, kbId, kbId, kbId) as StatsRow;
  }

  list(): KbDto[] {
    const rows = this.db.prepare(
      "SELECT * FROM knowledge_bases ORDER BY updated_at DESC"
    ).all() as Row[];
    return rows.map((r) => toDto(r, this.getStats(r.id)));
  }

  listByEmbeddingModel(modelId: string): KbDto[] {
    const rows = this.db.prepare(
      "SELECT * FROM knowledge_bases WHERE embedding_model_id = ?"
    ).all(modelId) as Row[];
    return rows.map((r) => toDto(r, this.getStats(r.id)));
  }

  findByName(name: string): KbDto | null {
    const r = this.db.prepare("SELECT * FROM knowledge_bases WHERE name = ?").get(name) as Row | undefined;
    if (!r) return null;
    return toDto(r, this.getStats(r.id));
  }

  update(id: string, patch: Partial<{ name: string; description: string | null; enabled: boolean; embeddingModelId: string | null }>): void {
    const cur = this.findById(id);
    if (!cur) throw new Error("knowledge base not found");
    const name = patch.name ?? cur.name;
    const description = patch.description === undefined ? cur.description : patch.description;
    const enabled = patch.enabled === undefined ? (cur.enabled ? 1 : 0) : (patch.enabled ? 1 : 0);
    const embeddingModelId = patch.embeddingModelId === undefined ? cur.embeddingModelId : patch.embeddingModelId;
    this.db.prepare(
      "UPDATE knowledge_bases SET name = ?, description = ?, enabled = ?, embedding_model_id = ?, updated_at = ? WHERE id = ?"
    ).run(name, description, enabled, embeddingModelId, Date.now(), id);
  }

  delete(id: string): void {
    this.db.prepare("DELETE FROM knowledge_bases WHERE id = ?").run(id);
  }
}
