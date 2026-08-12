import type Database from "better-sqlite3";
import { KbChunkDto } from "@pi-web-ui/shared";
import { tokenizeForFts } from "../../kb/fts-tokenize.js";

type Row = {
  rowid: number; kb_id: string; file_id: string; generation: number;
  seq: number; title_path: string | null; page_start: number | null;
  page_end: number | null; content: string; char_count: number | null;
  embedding: Buffer | null; created_at: number;
  modality: "text" | "image" | "video" | "audio";
  time_start_ms: number | null; time_end_ms: number | null;
  bbox_json: string | null; parent_chunk_id: number | null;
  segment_uid: string | null;
};

function parseBbox(value: string | null): { x: number; y: number; width: number; height: number } | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as { x: number; y: number; width: number; height: number };
  } catch {
    return null;
  }
}

function toDto(r: Row): KbChunkDto {
  return {
    id: r.rowid, segmentId: r.segment_uid ?? `${r.file_id}:${r.generation}:${r.seq}`,
    kbId: r.kb_id, fileId: r.file_id, seq: r.seq,
    titlePath: r.title_path, pageStart: r.page_start, pageEnd: r.page_end,
    content: r.content, charCount: r.char_count ?? r.content.length, createdAt: r.created_at,
    modality: r.modality ?? "text", timeStartMs: r.time_start_ms ?? null,
    timeEndMs: r.time_end_ms ?? null, bbox: parseBbox(r.bbox_json),
    parentChunkId: r.parent_chunk_id ?? null,
  };
}

export class KbChunkRepository {
  constructor(private db: Database.Database) {}

  insert(input: {
    kbId: string; fileId: string; generation: number; seq: number;
    titlePath: string | null; pageStart: number | null; pageEnd: number | null;
    content: string; charCount: number; embedding?: Buffer | null;
    modality?: "text" | "image" | "video" | "audio";
    timeStartMs?: number | null; timeEndMs?: number | null;
    bbox?: { x: number; y: number; width: number; height: number } | null;
    parentChunkId?: number | null;
  }): number {
    const now = Date.now();
    const info = this.db.prepare(`
      INSERT INTO kb_chunks (
        kb_id, file_id, generation, seq, title_path, page_start, page_end,
        content, char_count, embedding, modality, time_start_ms, time_end_ms,
        bbox_json, parent_chunk_id, segment_uid, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.kbId, input.fileId, input.generation, input.seq, input.titlePath,
      input.pageStart, input.pageEnd, input.content, input.charCount,
      input.embedding ?? null, input.modality ?? "text", input.timeStartMs ?? null,
      input.timeEndMs ?? null, input.bbox ? JSON.stringify(input.bbox) : null,
      input.parentChunkId ?? null, `${input.fileId}:${input.generation}:${input.seq}`, now,
    );
    const rowid = Number(info.lastInsertRowid);
    // 同步 FTS5 索引 — 用 tokenizeForFts 在 CJK 字符间插入空格，
    // 强制 unicode61 逐字索引，避免整行诗被当成单个 token
    const searchableText = input.titlePath ? `${input.titlePath}\n${input.content}` : input.content;
    this.db.prepare("INSERT INTO kb_chunks_fts (rowid, content) VALUES (?, ?)").run(rowid, tokenizeForFts(searchableText));
    return rowid;
  }

  upsertVector(input: {
    chunkId: number;
    vectorSpace: string;
    modality: "text" | "image" | "video" | "audio";
    modelId: string;
    modelVersion: string;
    dimension: number;
    embedding: Buffer;
  }): void {
    this.db.prepare(`
      INSERT INTO kb_segment_vectors (
        chunk_id, vector_space, modality, model_id, model_version,
        dimension, embedding, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(chunk_id, vector_space, model_id, model_version)
      DO UPDATE SET dimension = excluded.dimension,
                    embedding = excluded.embedding,
                    created_at = excluded.created_at
    `).run(
      input.chunkId, input.vectorSpace, input.modality, input.modelId,
      input.modelVersion, input.dimension, input.embedding, Date.now(),
    );
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
