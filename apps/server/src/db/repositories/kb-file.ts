import type Database from "better-sqlite3";
import { KbFileDto } from "@pi-web-ui/shared";
import { ulid } from "../../util/ulid.js";

type Row = {
  id: string; kb_id: string; name: string; ext: string; source: string;
  size: number; storage_path: string; status: string; enabled: number;
  parse_generation: number; fail_reason: string | null;
  char_count: number | null; page_count: number | null; chunk_count: number | null;
  last_parsed_at: number | null; created_at: number; updated_at: number;
};

function toDto(r: Row): KbFileDto {
  return {
    id: r.id, kbId: r.kb_id, name: r.name, ext: r.ext, source: r.source,
    size: r.size, status: r.status as KbFileDto["status"], enabled: r.enabled === 1,
    parseGeneration: r.parse_generation, failReason: r.fail_reason,
    charCount: r.char_count, pageCount: r.page_count, chunkCount: r.chunk_count,
    lastParsedAt: r.last_parsed_at, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export class KbFileRepository {
  constructor(private db: Database.Database) {}

  create(input: {
    kbId: string; name: string; ext: string; source: string;
    size: number; storagePath: string;
  }): KbFileDto {
    const id = ulid();
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO kb_files (id, kb_id, name, ext, source, size, storage_path, status, enabled, parse_generation, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 1, 0, ?, ?)
    `).run(id, input.kbId, input.name, input.ext, input.source, input.size, input.storagePath, now, now);
    return {
      id, kbId: input.kbId, name: input.name, ext: input.ext, source: input.source,
      size: input.size, status: "pending", enabled: true, parseGeneration: 0,
      failReason: null, charCount: null, pageCount: null, chunkCount: null,
      lastParsedAt: null, createdAt: now, updatedAt: now,
    };
  }

  findById(id: string): KbFileDto | null {
    const r = this.db.prepare("SELECT * FROM kb_files WHERE id = ?").get(id) as Row | undefined;
    return r ? toDto(r) : null;
  }

  listByKb(kbId: string): KbFileDto[] {
    return (this.db.prepare(
      "SELECT * FROM kb_files WHERE kb_id = ? ORDER BY created_at DESC"
    ).all(kbId) as Row[]).map(toDto);
  }

  findByNameInKb(kbId: string, name: string): KbFileDto | null {
    const r = this.db.prepare(
      "SELECT * FROM kb_files WHERE kb_id = ? AND name = ?"
    ).get(kbId, name) as Row | undefined;
    return r ? toDto(r) : null;
  }

  updateStatus(id: string, patch: {
    status: string; failReason?: string | null;
    parseGeneration?: number; charCount?: number | null;
    pageCount?: number | null; chunkCount?: number | null;
    lastParsedAt?: number | null;
  }): void {
    this.db.prepare(`
      UPDATE kb_files SET
        status = ?,
        fail_reason = ?,
        parse_generation = COALESCE(?, parse_generation),
        char_count = ?,
        page_count = ?,
        chunk_count = ?,
        last_parsed_at = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      patch.status,
      patch.failReason !== undefined ? patch.failReason : null,
      patch.parseGeneration ?? null,
      patch.charCount !== undefined ? patch.charCount : null,
      patch.pageCount !== undefined ? patch.pageCount : null,
      patch.chunkCount !== undefined ? patch.chunkCount : null,
      patch.lastParsedAt !== undefined ? patch.lastParsedAt : null,
      Date.now(), id,
    );
  }

  setEnabled(id: string, enabled: boolean): void {
    this.db.prepare("UPDATE kb_files SET enabled = ?, updated_at = ? WHERE id = ?")
      .run(enabled ? 1 : 0, Date.now(), id);
  }

  updateName(id: string, name: string): void {
    this.db.prepare("UPDATE kb_files SET name = ?, updated_at = ? WHERE id = ?")
      .run(name, Date.now(), id);
  }

  updateStoragePath(id: string, size: number, storagePath: string): void {
    this.db.prepare("UPDATE kb_files SET size = ?, storage_path = ?, updated_at = ? WHERE id = ?")
      .run(size, storagePath, Date.now(), id);
  }

  getStoragePath(id: string): string | null {
    const row = this.db.prepare("SELECT storage_path FROM kb_files WHERE id = ?").get(id) as { storage_path: string } | undefined;
    return row ? row.storage_path : null;
  }

  delete(id: string): void {
    this.db.prepare("DELETE FROM kb_files WHERE id = ?").run(id);
  }

  incrementParseGeneration(id: string): number {
    this.db.prepare(
      "UPDATE kb_files SET parse_generation = parse_generation + 1, updated_at = ? WHERE id = ?"
    ).run(Date.now(), id);
    const row = this.db.prepare("SELECT parse_generation FROM kb_files WHERE id = ?").get(id) as { parse_generation: number };
    return row.parse_generation;
  }

  setParsing(id: string): void {
    this.db.prepare(
      "UPDATE kb_files SET status = 'parsing', fail_reason = NULL, updated_at = ? WHERE id = ?"
    ).run(Date.now(), id);
  }
}
