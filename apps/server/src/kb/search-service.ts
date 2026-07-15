import type Database from "better-sqlite3";
import { KbSearchHitDto } from "@pi-web-ui/shared";

export interface SearchInput {
  query: string;
  kbIds: string[];
  fileIds?: string[];
  limit?: number;
}

export interface SearchResult {
  hits: KbSearchHitDto[];
  durationMs: number;
}

export class KbSearchService {
  constructor(private db: Database.Database) {}

  search(input: SearchInput): SearchResult {
    const start = performance.now();
    const { query, kbIds, fileIds, limit = 8 } = input;

    if (!query.trim() || !kbIds.length) {
      return { hits: [], durationMs: 0 };
    }

    const ftsQuery = buildFtsQuery(query);
    if (!ftsQuery) {
      return { hits: [], durationMs: 0 };
    }

    // Build parameterized query
    const kbPlaceholders = kbIds.map((_, i) => `?`).join(",");
    let sql = `
      SELECT
        c.rowid AS chunkId,
        c.kb_id AS kbId,
        c.file_id AS fileId,
        c.seq,
        c.title_path AS titlePath,
        c.page_start AS pageStart,
        c.page_end AS pageEnd,
        c.content,
        bm25(kb_chunks_fts) AS score,
        snippet(kb_chunks_fts, 0, '<mark>', '</mark>', '…', 24) AS snippet,
        kb.name AS kbName,
        f.name AS fileName,
        f.updated_at AS fileUpdatedAt
      FROM kb_chunks_fts
      JOIN kb_chunks c ON c.rowid = kb_chunks_fts.rowid
      JOIN kb_files f ON f.id = c.file_id
      JOIN knowledge_bases kb ON kb.id = c.kb_id
      WHERE kb_chunks_fts MATCH ?
        AND c.kb_id IN (${kbPlaceholders})
        AND c.generation = f.parse_generation
        AND f.parse_generation > 0
        AND f.enabled = 1
        AND kb.enabled = 1
    `;

    const params: (string | number)[] = [ftsQuery, ...kbIds];

    if (fileIds && fileIds.length > 0) {
      const filePlaceholders = fileIds.map(() => "?").join(",");
      sql += ` AND c.file_id IN (${filePlaceholders})`;
      params.push(...fileIds);
    }

    sql += ` ORDER BY bm25(kb_chunks_fts), f.updated_at DESC LIMIT ?`;
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as any[];

    // Deduplicate: same content appears only once
    const hits = deduplicateHits(rows);

    return { hits, durationMs: Math.round(performance.now() - start) };
  }
}

function buildFtsQuery(input: string): string {
  // Split by whitespace, wrap each token as a phrase
  const tokens = input.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return "";
  return tokens.map((t) => {
    const escaped = t.replace(/"/g, '""');
    return `"${escaped}"`;
  }).join(" ");
}

function deduplicateHits(rows: any[]): KbSearchHitDto[] {
  const seen = new Set<string>();
  const result: KbSearchHitDto[] = [];

  for (const row of rows) {
    const contentKey = row.content;
    if (seen.has(contentKey)) continue;
    seen.add(contentKey);

    result.push({
      chunkId: row.chunkId,
      kbId: row.kbId,
      kbName: row.kbName,
      fileId: row.fileId,
      fileName: row.fileName,
      seq: row.seq,
      titlePath: row.titlePath,
      pageStart: row.pageStart,
      pageEnd: row.pageEnd,
      content: row.content,
      snippet: row.snippet,
      score: row.score,
    });
  }

  return result;
}
