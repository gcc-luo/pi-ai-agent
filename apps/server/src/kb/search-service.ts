import type Database from "better-sqlite3";
import { KbSearchHitDto } from "@pi-web-ui/shared";
import { decodeEmbedding, cosineSimilarity, EmbeddingModelConfig, getEmbedding } from "./embedding-client.js";
import { segmentQuery } from "./fts-tokenize.js";

export interface SearchInput {
  query: string;
  kbIds?: string[];
  fileIds?: string[];
  limit?: number;
  embeddingModel?: EmbeddingModelConfig;
  scopes?: SearchScope[];
}

export interface SearchScope {
  kbId: string;
  /** null/undefined means every searchable file in this KB. */
  fileIds?: string[] | null;
  embeddingModel?: EmbeddingModelConfig;
}

export interface SearchResult {
  hits: KbSearchHitDto[];
  durationMs: number;
}

const FTS_CANDIDATE_LIMIT = 20;
const VECTOR_CANDIDATE_LIMIT = 20;
const RRF_K = 60;  // RRF constant — higher value compresses rank differences
const MIN_VECTOR_SIMILARITY = 0.35;

type ScoredCandidate = { hit: KbSearchHitDto; score: number; embedding: Buffer | null };

export class KbSearchService {
  constructor(private db: Database.Database) {}

  async search(input: SearchInput): Promise<SearchResult> {
    const start = performance.now();
    const { query, limit = 8 } = input;
    const scopes = normalizeScopes(input);
    const kbIds = scopes.map((scope) => scope.kbId);

    console.log(`[KB Search] ─── start ─── query="${query.slice(0, 60)}" kbIds=[${kbIds.join(",")}] limit=${limit} vectorSpaces=${scopes.filter((s) => s.embeddingModel).length}`);

    if (!query.trim() || !kbIds.length) {
      console.log(`[KB Search] ─── done (empty input, 0ms)`);
      return { hits: [], durationMs: 0 };
    }

    // ── Step 1: FTS5 keyword search ──
    const t1 = performance.now();
    const ftsCandidates = this.ftsSearchPhase(query, scopes);
    console.log(`[KB Search] Step 1/FTS5 keyword: ${ftsCandidates.length} candidates (${Math.round(performance.now() - t1)}ms)`);

    // ── Step 1b: instr fallback for short queries (≤2 CJK chars) ──
    if (ftsCandidates.length < limit && isShortCjkQuery(query)) {
      const t1b = performance.now();
      const instrHits = this.instrFallback(query, scopes, limit - ftsCandidates.length);
      if (instrHits.length > 0) {
        console.log(`[KB Search] Step 1b/instr fallback: +${instrHits.length} hits (${Math.round(performance.now() - t1b)}ms)`);
        ftsCandidates.push(...instrHits);
      }
    }

    const vectorGroups = groupVectorScopes(scopes);
    if (ftsCandidates.length === 0 && vectorGroups.length === 0) {
      const ms = Math.round(performance.now() - start);
      console.log(`[KB Search] ─── done (no results, ${ms}ms)`);
      return { hits: [], durationMs: ms };
    }

    // ── Step 2: Vector search (independent retrieval) ──
    let vectorCandidates: ScoredCandidate[] = [];
    if (vectorGroups.length > 0) {
      const t2 = performance.now();
      const vectorLists = await Promise.all(vectorGroups.map(({ model, scopes: groupScopes }) =>
        this.vectorSearch(query, model, groupScopes, VECTOR_CANDIDATE_LIMIT)
      ));
      vectorCandidates = vectorLists.flat();
      console.log(`[KB Search] Step 2/vector search: ${vectorCandidates.length} candidates (${Math.round(performance.now() - t2)}ms)`);
    } else {
      console.log(`[KB Search] Step 2/vector search: skipped (no embedding model)`);
    }

    // ── Step 3: Merge & rank ──
    let hits: KbSearchHitDto[];
    let strategy: string;
    if (vectorCandidates.length > 0) {
      hits = rrfMerge(ftsCandidates, vectorCandidates, limit);
      strategy = "RRF merge (FTS + vector)";
    } else if (ftsCandidates.length > 0) {
      hits = ftsCandidates
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((c) => c.hit);
      strategy = "FTS5 BM25 rank";
    } else {
      hits = vectorCandidates
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((c) => c.hit);
      strategy = "vector cosine rank";
    }

    // ── Step 4: Ensure all hits have snippets ──
    // Vector-only results may lack snippets; generate them from content.
    const queryWords = segmentQuery(query).filter((w) => /[a-zA-Z0-9㐀-鿿]/.test(w));
    for (const h of hits) {
      if (!h.snippet && h.content) {
        h.snippet = buildHighlightSnippet(h.content, queryWords);
      }
    }

    const ms = Math.round(performance.now() - start);
    console.log(`[KB Search] Step 3/merge: strategy="${strategy}" → ${hits.length} hits`);
    hits.forEach((h, i) => {
      console.log(`[KB Search]   #${i + 1} score=${h.score.toFixed(4)} file="${h.fileName}" chunk=${h.chunkId} seq=${h.seq} pages=${h.pageStart}-${h.pageEnd}`);
    });
    console.log(`[KB Search] ─── done (${ms}ms) ───`);
    return { hits, durationMs: ms };
  }

  // ─── FTS5 keyword search ───

  private ftsSearchPhase(
    query: string,
    scopes: SearchScope[],
  ): ScoredCandidate[] {
    const ftsQuery = buildFtsQuery(query);
    if (!ftsQuery) return [];
    // Extract query words for JS-based snippet highlighting
    const queryWords = segmentQuery(query).filter((w) => /[a-zA-Z0-9㐀-鿿]/.test(w));
    console.log(`[KB Search]   ftsQuery="${ftsQuery}" words=[${queryWords.join(", ")}]`);
    return this.ftsSearch(ftsQuery, scopes, FTS_CANDIDATE_LIMIT, queryWords);
  }

  private ftsSearch(
    ftsQuery: string,
    scopes: SearchScope[],
    limit: number,
    queryWords: string[],
  ): ScoredCandidate[] {
    const scopeFilter = buildScopeFilter(scopes, "c");
    // Note: no snippet() — FTS5 snippet offsets are wrong when the index is
    // pre-tokenized (spaces between CJK chars) but the external content table
    // stores the original text. We build snippets in JS instead.
    let sql = `
      SELECT
        c.rowid AS chunkId,
        c.segment_uid AS segmentId,
        c.generation AS revision,
        c.kb_id AS kbId,
        c.file_id AS fileId,
        c.seq,
        c.title_path AS titlePath,
        c.page_start AS pageStart,
        c.page_end AS pageEnd,
        c.modality,
        c.time_start_ms AS timeStartMs,
        c.time_end_ms AS timeEndMs,
        c.bbox_json AS bboxJson,
        c.content,
        c.embedding,
        bm25(kb_chunks_fts) AS score,
        kb.name AS kbName,
        f.name AS fileName
      FROM kb_chunks_fts
      JOIN kb_chunks c ON c.rowid = kb_chunks_fts.rowid
      JOIN kb_files f ON f.id = c.file_id
      JOIN knowledge_bases kb ON kb.id = c.kb_id
      WHERE kb_chunks_fts MATCH ?
        AND (${scopeFilter.sql})
        AND c.generation = f.parse_generation
        AND f.parse_generation > 0
        AND f.enabled = 1
        AND kb.enabled = 1
    `;

    const params: (string | number)[] = [ftsQuery, ...scopeFilter.params];

    // SQLite FTS5 returns lower BM25 values for better matches.
    sql += ` ORDER BY bm25(kb_chunks_fts) ASC LIMIT ?`;
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as any[];

    return rows.map((row) => {
      const hit = rowToHit({ ...row, score: -row.score });
      hit.snippet = buildHighlightSnippet(row.content, queryWords);
      hit.keywordScore = -row.score;
      return { hit, score: -row.score, embedding: row.embedding };
    });
  }

  // ─── instr fallback for short CJK queries ───

  private instrFallback(
    query: string,
    scopes: SearchScope[],
    limit: number,
  ): ScoredCandidate[] {
    const keyword = query.trim();
    if (!keyword) return [];

    const scopeFilter = buildScopeFilter(scopes, "c");
    let sql = `
      SELECT
        c.rowid AS chunkId,
        c.segment_uid AS segmentId,
        c.generation AS revision,
        c.kb_id AS kbId,
        c.file_id AS fileId,
        c.seq,
        c.title_path AS titlePath,
        c.page_start AS pageStart,
        c.page_end AS pageEnd,
        c.modality,
        c.time_start_ms AS timeStartMs,
        c.time_end_ms AS timeEndMs,
        c.bbox_json AS bboxJson,
        c.content,
        c.embedding,
        kb.name AS kbName,
        f.name AS fileName
      FROM kb_chunks c
      JOIN kb_files f ON f.id = c.file_id
      JOIN knowledge_bases kb ON kb.id = c.kb_id
      WHERE instr(c.content, ?) > 0
        AND (${scopeFilter.sql})
        AND c.generation = f.parse_generation
        AND f.parse_generation > 0
        AND f.enabled = 1
        AND kb.enabled = 1
    `;

    const params: (string | number)[] = [keyword, ...scopeFilter.params];

    sql += ` LIMIT ?`;
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as any[];

    return rows.map((row) => {
      const hit = rowToHit(row);
      hit.snippet = buildInstrSnippet(row.content, keyword);
      hit.score = -10;  // Low BM25-equivalent so FTS results rank higher
      return { hit, score: -10, embedding: row.embedding };
    });
  }

  // ─── Vector search (independent retrieval, not just re-rank) ───

  private async vectorSearch(
    query: string,
    embeddingModel: EmbeddingModelConfig,
    scopes: SearchScope[],
    limit: number,
  ): Promise<ScoredCandidate[]> {
    // Generate query embedding
    let queryEmbedding: number[];
    try {
      queryEmbedding = await getEmbedding(embeddingModel, query);
      console.log(`[KB Search]   query embedding: model=${embeddingModel.modelId} dimension=${queryEmbedding.length}`);
    } catch (err: any) {
      console.error(`[KB Search]   query embedding failed: ${err.message}`);
      return [];
    }

    // Load all chunks with embeddings from the target KBs
    const scopeFilter = buildScopeFilter(scopes, "c");
    let sql = `
      SELECT
        c.rowid AS chunkId,
        c.segment_uid AS segmentId,
        c.generation AS revision,
        c.kb_id AS kbId,
        c.file_id AS fileId,
        c.seq,
        c.title_path AS titlePath,
        c.page_start AS pageStart,
        c.page_end AS pageEnd,
        c.modality,
        c.time_start_ms AS timeStartMs,
        c.time_end_ms AS timeEndMs,
        c.bbox_json AS bboxJson,
        c.content,
        v.embedding,
        kb.name AS kbName,
        f.name AS fileName
      FROM kb_chunks c
      JOIN kb_segment_vectors v ON v.chunk_id = c.rowid
      JOIN kb_files f ON f.id = c.file_id
      JOIN knowledge_bases kb ON kb.id = c.kb_id
      WHERE (${scopeFilter.sql})
        AND c.generation = f.parse_generation
        AND f.parse_generation > 0
        AND f.enabled = 1
        AND kb.enabled = 1
        AND v.vector_space = 'text'
        AND v.model_id = ?
        AND v.model_version = ?
        AND v.dimension = ?
    `;

    const params: (string | number)[] = [
      ...scopeFilter.params,
      embeddingModel.modelId,
      embeddingModel.modelVersion ?? "unknown",
      queryEmbedding.length,
    ];

    const rows = this.db.prepare(sql).all(...params) as any[];

    // Compute cosine similarity for each chunk
    const scored: ScoredCandidate[] = [];
    for (const row of rows) {
      if (!row.embedding) continue;
      const chunkEmb = decodeEmbedding(row.embedding);
      const score = cosineSimilarity(queryEmbedding, chunkEmb);
      if (score < MIN_VECTOR_SIMILARITY) continue;
      const hit = rowToHit(row);
      hit.vectorScore = score;
      scored.push({
        hit,
        score,
        embedding: row.embedding,
      });
    }

    // Sort by similarity descending
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }
}

function normalizeScopes(input: SearchInput): SearchScope[] {
  if (input.scopes?.length) return input.scopes;
  return (input.kbIds ?? []).map((kbId) => ({
    kbId,
    fileIds: input.fileIds,
    embeddingModel: input.embeddingModel,
  }));
}

function buildScopeFilter(scopes: SearchScope[], alias: string): { sql: string; params: string[] } {
  const params: string[] = [];
  const clauses = scopes.map((scope) => {
    params.push(scope.kbId);
    if (!scope.fileIds?.length) return `${alias}.kb_id = ?`;
    params.push(...scope.fileIds);
    return `(${alias}.kb_id = ? AND ${alias}.file_id IN (${scope.fileIds.map(() => "?").join(",")}))`;
  });
  return { sql: clauses.length ? clauses.join(" OR ") : "0", params };
}

function groupVectorScopes(scopes: SearchScope[]): { model: EmbeddingModelConfig; scopes: SearchScope[] }[] {
  const groups = new Map<string, { model: EmbeddingModelConfig; scopes: SearchScope[] }>();
  for (const scope of scopes) {
    const model = scope.embeddingModel;
    if (!model) continue;
    const key = `${model.apiBaseUrl}\u0000${model.modelId}\u0000${model.modelVersion ?? "unknown"}`;
    const group = groups.get(key) ?? { model, scopes: [] };
    group.scopes.push(scope);
    groups.set(key, group);
  }
  return [...groups.values()];
}

// ─── RRF (Reciprocal Rank Fusion) ───

function rrfMerge(
  ftsResults: ScoredCandidate[],
  vectorResults: ScoredCandidate[],
  limit: number,
): KbSearchHitDto[] {
  // Sort each list by its own score (descending)
  const ftsSorted = [...ftsResults].sort((a, b) => b.score - a.score);
  const vecSorted = [...vectorResults].sort((a, b) => b.score - a.score);

  // Compute RRF score for each chunk
  const rrfScores = new Map<number, { hit: KbSearchHitDto; rrfScore: number }>();

  ftsSorted.forEach((c, rank) => {
    const chunkId = c.hit.chunkId;
    const existing = rrfScores.get(chunkId);
    const rrf = 1 / (RRF_K + rank + 1);
    if (existing) {
      existing.rrfScore += rrf;
    } else {
      rrfScores.set(chunkId, { hit: c.hit, rrfScore: rrf });
    }
  });

  vecSorted.forEach((c, rank) => {
    const chunkId = c.hit.chunkId;
    const existing = rrfScores.get(chunkId);
    const rrf = 1 / (RRF_K + rank + 1);
    if (existing) {
      existing.rrfScore += rrf;
      existing.hit.vectorScore = c.hit.vectorScore;
    } else {
      rrfScores.set(chunkId, { hit: c.hit, rrfScore: rrf });
    }
  });

  // Sort by RRF score and return top-K
  return [...rrfScores.values()]
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .slice(0, limit)
    .map((r) => ({ ...r.hit, score: r.rrfScore }));
}

// ─── Helpers ───

function buildFtsQuery(input: string): string {
  const words = segmentQuery(input);
  if (!words.length) return "";

  return words.map((w) => {
    const escaped = w.replace(/"/g, '""');
    if (/[㐀-鿿]/.test(w)) return escaped;
    return `"${escaped}"`;
  }).join(" ");
}

/** Check if query is a short CJK string (≤2 characters) — needs instr fallback. */
function isShortCjkQuery(query: string): boolean {
  const trimmed = query.trim();
  const chars = [...trimmed]; // spread handles surrogate pairs
  if (chars.length > 2) return false;
  return /[㐀-鿿]/.test(trimmed);
}

/**
 * Build a snippet by highlighting query words in the ORIGINAL content.
 * This replaces FTS5's snippet() which produces wrong offsets when the
 * FTS index is pre-tokenized (CJK chars separated by spaces) but the
 * external content table stores the original unmodified text.
 *
 * Strategy: find the first occurrence of any query word, extract a window
 * around it, and wrap all query words in <mark> tags within that window.
 */
function buildHighlightSnippet(content: string, queryWords: string[]): string {
  if (!queryWords.length) return content.slice(0, 200);

  // Find the earliest occurrence of any query word
  let bestIdx = Infinity;
  let bestWord = "";
  for (const w of queryWords) {
    const idx = content.indexOf(w);
    if (idx >= 0 && idx < bestIdx) {
      bestIdx = idx;
      bestWord = w;
    }
  }

  if (bestIdx === Infinity) {
    // No word found in content (shouldn't happen if FTS matched)
    return content.slice(0, 200);
  }

  // Extract a window around the first match (~200 chars)
  const windowSize = 200;
  const start = Math.max(0, bestIdx - Math.floor(windowSize * 0.3));
  const end = Math.min(content.length, start + windowSize);
  const adjustedStart = start > 0 ? start : 0;
  let snippet = content.slice(adjustedStart, end);

  // Highlight ALL query words found in the snippet (longest first to avoid partial matches)
  const sortedWords = [...queryWords].sort((a, b) => b.length - a.length);
  for (const w of sortedWords) {
    // Escape regex special chars in the word
    const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    snippet = snippet.replace(new RegExp(escaped, "g"), `<mark>${w}</mark>`);
  }

  const prefix = adjustedStart > 0 ? "…" : "";
  const suffix = end < content.length ? "…" : "";
  return `${prefix}${snippet}${suffix}`;
}

/** Build a simple snippet by highlighting the keyword in the content (instr fallback). */
function buildInstrSnippet(content: string, keyword: string): string {
  const idx = content.indexOf(keyword);
  if (idx < 0) return content.slice(0, 200);
  const start = Math.max(0, idx - 40);
  const end = Math.min(content.length, idx + keyword.length + 40);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < content.length ? "…" : "";
  const before = content.slice(start, idx);
  const after = content.slice(idx + keyword.length, end);
  return `${prefix}${before}<mark>${keyword}</mark>${after}${suffix}`;
}

function rowToHit(row: any): KbSearchHitDto {
  return {
    chunkId: row.chunkId,
    segmentId: row.segmentId ?? `${row.fileId}:${row.revision ?? 0}:${row.seq}`,
    revision: row.revision ?? 0,
    kbId: row.kbId,
    kbName: row.kbName,
    fileId: row.fileId,
    fileName: row.fileName,
    seq: row.seq,
    titlePath: row.titlePath,
    pageStart: row.pageStart,
    pageEnd: row.pageEnd,
    modality: row.modality ?? "text",
    timeStartMs: row.timeStartMs ?? null,
    timeEndMs: row.timeEndMs ?? null,
    bbox: parseJsonObject(row.bboxJson),
    content: row.content,
    snippet: row.snippet ?? "",
    score: row.score ?? 0,
  };
}

function parseJsonObject(value: unknown): any | null {
  if (typeof value !== "string" || !value) return null;
  try { return JSON.parse(value); } catch { return null; }
}
