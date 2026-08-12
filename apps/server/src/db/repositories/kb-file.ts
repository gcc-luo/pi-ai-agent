import type Database from "better-sqlite3";
import { KbFileDto, KbFilePage } from "@pi-web-ui/shared";
import { ulid } from "../../util/ulid.js";

type Row = {
  id: string; kb_id: string; name: string; ext: string; source: string;
  size: number; storage_path: string; status: string; enabled: number;
  parse_generation: number; active_revision_id: string | null; fail_reason: string | null;
  char_count: number | null; page_count: number | null; chunk_count: number | null;
  last_parsed_at: number | null; created_at: number; updated_at: number;
  asset_kind: "document" | "image" | "video" | "audio";
};

function toDto(r: Row): KbFileDto {
  return {
    id: r.id, kbId: r.kb_id, name: r.name, ext: r.ext, source: r.source,
    assetKind: r.asset_kind ?? "document",
    size: r.size, status: r.status as KbFileDto["status"], enabled: r.enabled === 1,
    parseGeneration: r.parse_generation, activeRevisionId: r.active_revision_id ?? null,
    failReason: r.fail_reason,
    charCount: r.char_count, pageCount: r.page_count, chunkCount: r.chunk_count,
    lastParsedAt: r.last_parsed_at, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export class KbFileRepository {
  constructor(private db: Database.Database) {}

  create(input: {
    kbId: string; name: string; ext: string; source: string;
    size: number; storagePath: string; assetKind?: "document" | "image" | "video" | "audio";
  }): KbFileDto {
    const id = ulid();
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO kb_files (id, kb_id, name, ext, source, size, storage_path, asset_kind, status, enabled, parse_generation, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 1, 0, ?, ?)
    `).run(id, input.kbId, input.name, input.ext, input.source, input.size, input.storagePath, input.assetKind ?? "document", now, now);
    return {
      id, kbId: input.kbId, name: input.name, ext: input.ext, source: input.source,
      size: input.size, assetKind: input.assetKind ?? "document",
      status: "pending", enabled: true, parseGeneration: 0, activeRevisionId: null,
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

  /**
   * 分页查询 KB 文件列表。hasActive 反映整个 KB 是否存在 pending/parsing
   * 文件（不受过滤条件影响），用于驱动客户端轮询——即使当前过滤条件下
   * 看不到 parsing 文件，只要 KB 内还有，轮询就应继续。
   */
  listByKbPaged(kbId: string, opts: {
    search?: string;
    status?: string;
    ext?: string;
    page: number;
    pageSize: number;
  }): KbFilePage {
    const where: string[] = ["kb_id = ?"];
    const params: (string | number)[] = [kbId];
    if (opts.search) {
      where.push("LOWER(name) LIKE ?");
      params.push(`%${opts.search.toLowerCase()}%`);
    }
    if (opts.status) {
      where.push("status = ?");
      params.push(opts.status);
    }
    if (opts.ext) {
      where.push("ext = ?");
      params.push(opts.ext);
    }
    const whereSql = where.join(" AND ");
    const offset = (opts.page - 1) * opts.pageSize;

    const items = (this.db.prepare(
      `SELECT * FROM kb_files WHERE ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).all(...params, opts.pageSize, offset) as Row[]).map(toDto);

    const totalRow = this.db.prepare(
      `SELECT COUNT(*) AS c FROM kb_files WHERE ${whereSql}`
    ).get(...params) as { c: number };

    const hasActiveRow = this.db.prepare(
      "SELECT EXISTS(SELECT 1 FROM kb_files WHERE kb_id = ? AND status IN ('pending','parsing')) AS e"
    ).get(kbId) as { e: number };

    return {
      items,
      total: totalRow.c,
      page: opts.page,
      pageSize: opts.pageSize,
      hasActive: hasActiveRow.e === 1,
    };
  }

  findByNameInKb(kbId: string, name: string): KbFileDto | null {
    const r = this.db.prepare(
      "SELECT * FROM kb_files WHERE kb_id = ? AND name = ?"
    ).get(kbId, name) as Row | undefined;
    return r ? toDto(r) : null;
  }

  /** 列出 KB 内全部 ready 且 enabled 的文件，用于对话侧 KB Picker/Banner，不分页 */
  listSearchableByKb(kbId: string, limit = 1000): KbFileDto[] {
    return (this.db.prepare(
      "SELECT * FROM kb_files WHERE kb_id = ? AND status = 'ready' AND enabled = 1 ORDER BY created_at DESC LIMIT ?"
    ).all(kbId, limit) as Row[]).map(toDto);
  }

  updateStatus(id: string, patch: {
    status: string; failReason?: string | null;
    parseGeneration?: number; activeRevisionId?: string | null; charCount?: number | null;
    pageCount?: number | null; chunkCount?: number | null;
    lastParsedAt?: number | null;
  }): void {
    const assignments = ["status = ?"];
    const params: unknown[] = [patch.status];
    const add = (column: string, value: unknown): void => {
      assignments.push(`${column} = ?`);
      params.push(value);
    };
    if (patch.failReason !== undefined) add("fail_reason", patch.failReason);
    if (patch.parseGeneration !== undefined) add("parse_generation", patch.parseGeneration);
    if (patch.activeRevisionId !== undefined) add("active_revision_id", patch.activeRevisionId);
    if (patch.charCount !== undefined) add("char_count", patch.charCount);
    if (patch.pageCount !== undefined) add("page_count", patch.pageCount);
    if (patch.chunkCount !== undefined) add("chunk_count", patch.chunkCount);
    if (patch.lastParsedAt !== undefined) add("last_parsed_at", patch.lastParsedAt);
    add("updated_at", Date.now());
    params.push(id);
    this.db.prepare(`UPDATE kb_files SET ${assignments.join(", ")} WHERE id = ?`).run(...params);
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

  nextParseGeneration(id: string): number {
    const row = this.db.prepare(`
      SELECT MAX(generation) AS max_generation FROM (
        SELECT generation FROM kb_chunks WHERE file_id = ?
        UNION ALL
        SELECT generation FROM kb_asset_revisions WHERE file_id = ?
      )
    `).get(id, id) as { max_generation: number | null };
    const file = this.findById(id);
    if (!file) throw new Error("knowledge base file not found");
    return Math.max(file.parseGeneration, row.max_generation ?? 0) + 1;
  }

  markPending(id: string): void {
    this.db.prepare(
      "UPDATE kb_files SET status = 'pending', fail_reason = NULL, updated_at = ? WHERE id = ?"
    ).run(Date.now(), id);
  }

  setParsing(id: string): void {
    this.db.prepare(
      "UPDATE kb_files SET status = 'parsing', fail_reason = NULL, updated_at = ? WHERE id = ?"
    ).run(Date.now(), id);
  }
}
