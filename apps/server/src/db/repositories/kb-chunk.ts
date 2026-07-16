import type Database from "better-sqlite3";
import { KbChunkDto } from "@pi-web-ui/shared";

type Row = {
  rowid: number; kb_id: string; file_id: string; generation: number;
  seq: number; title_path: string | null; page_start: number | null;
  page_end: number | null; content: string; char_count: number | null;
  embedding: Buffer | null; created_at: number;
};

function toDto(r: Row): KbChunkDto {
  return {
    id: r.rowid, kbId: r.kb_id, fileId: r.file_id, seq: r.seq,
    titlePath: r.title_path, pageStart: r.page_start, pageEnd: r.page_end,
    content: r.content, charCount: r.char_count ?? r.content.length, createdAt: r.created_at,
  };
}

export class KbChunkRepository {
  constructor(private db: Database.Database) {}

  insert(input: {
    kbId: string; fileId: string; generation: number; seq: number;
    titlePath: string | null; pageStart: number | null; pageEnd: number | null;
    content: string; charCount: number; embedding?: Buffer | null;
  }): number {
    const now = Date.now();
    const info = this.db.prepare(`
      INSERT INTO kb_chunks (kb_id, file_id, generation, seq, title_path, page_start, page_end, content, char_count, embedding, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(input.kbId, input.fileId, input.generation, input.seq, input.titlePath, input.pageStart, input.pageEnd, input.content, input.charCount, input.embedding ?? null, now);
    const rowid = Number(info.lastInsertRowid);
    // 同步 FTS5 索引
    this.db.prepare("INSERT INTO kb_chunks_fts (rowid, content) VALUES (?, ?)").run(rowid, input.content);
    return rowid;
  }

  updateEmbedding(rowid: number, embedding: Buffer): void {
    this.db.prepare("UPDATE kb_chunks SET embedding = ? WHERE rowid = ?").run(embedding, rowid);
  }

  listByFile(fileId: string, generation?: number): KbChunkDto[] {
    const sql = generation !== undefined
      ? "SELECT * FROM kb_chunks WHERE file_id = ? AND generation = ? ORDER BY seq"
      : "SELECT * FROM kb_chunks WHERE file_id = ? ORDER BY generation DESC, seq";
    const params = generation !== undefined ? [fileId, generation] : [fileId];
    return (this.db.prepare(sql).all(...params) as Row[]).map(toDto);
  }

  listByFileWithEmbedding(fileId: string, generation: number): { rowid: number; content: string; embedding: Buffer | null }[] {
    return this.db.prepare(
      "SELECT rowid, content, embedding FROM kb_chunks WHERE file_id = ? AND generation = ? ORDER BY seq"
    ).all(fileId, generation) as { rowid: number; content: string; embedding: Buffer | null }[];
  }

  deleteByFileAndGeneration(fileId: string, generation: number): void {
    const rows = this.db.prepare(
      "SELECT rowid FROM kb_chunks WHERE file_id = ? AND generation = ?"
    ).all(fileId, generation) as { rowid: number }[];
    const delFts = this.db.prepare("DELETE FROM kb_chunks_fts WHERE rowid = ?");
    for (const r of rows) delFts.run(r.rowid);
    this.db.prepare("DELETE FROM kb_chunks WHERE file_id = ? AND generation = ?").run(fileId, generation);
  }

  deleteByFile(fileId: string): void {
    const rows = this.db.prepare("SELECT rowid FROM kb_chunks WHERE file_id = ?").all(fileId) as { rowid: number }[];
    const delFts = this.db.prepare("DELETE FROM kb_chunks_fts WHERE rowid = ?");
    for (const r of rows) delFts.run(r.rowid);
    this.db.prepare("DELETE FROM kb_chunks WHERE file_id = ?").run(fileId);
  }

  deleteStaleGenerations(fileId: string, currentGeneration: number): void {
    const rows = this.db.prepare(
      "SELECT rowid FROM kb_chunks WHERE file_id = ? AND generation != ?"
    ).all(fileId, currentGeneration) as { rowid: number }[];
    const delFts = this.db.prepare("DELETE FROM kb_chunks_fts WHERE rowid = ?");
    for (const r of rows) delFts.run(r.rowid);
    this.db.prepare(
      "DELETE FROM kb_chunks WHERE file_id = ? AND generation != ?"
    ).run(fileId, currentGeneration);
  }

  findById(rowid: number): KbChunkDto | null {
    const r = this.db.prepare("SELECT * FROM kb_chunks WHERE rowid = ?").get(rowid) as Row | undefined;
    return r ? toDto(r) : null;
  }

  findChunksWithEmbeddings(kbId: string, generation: number): { rowid: number; content: string; embedding: Buffer | null }[] {
    return this.db.prepare(
      `SELECT c.rowid, c.content, c.embedding
       FROM kb_chunks c
       JOIN kb_files f ON f.id = c.file_id
       WHERE c.kb_id = ? AND c.generation = f.parse_generation AND c.generation = ? AND c.embedding IS NOT NULL`
    ).all(kbId, generation) as { rowid: number; content: string; embedding: Buffer | null }[];
  }
}
