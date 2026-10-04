import { buildHighlightSnippet, buildInstrSnippet } from "./search-snippet.js";
import type Database from "better-sqlite3";
import { KbSearchDiagnostics, KbSearchHitDto } from "@pi-web-ui/shared";
import { decodeEmbedding, cosineSimilarity, EmbeddingModelConfig, getEmbeddings } from "./embedding-client.js";
import { segmentQuery } from "./fts-tokenize.js";
import { buildSearchQueryVariants } from "./query-text.js";

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
  diagnostics: KbSearchDiagnostics;
}

const FTS_CANDIDATE_LIMIT = 20;
const VECTOR_CANDIDATE_LIMIT = 40;
const RRF_K = 60;  // RRF constant — higher value compresses rank differences
const LEXICAL_STOP_WORDS = new Set([
  "知识库", "资料库", "文档库", "里面", "其中", "当前", "这个", "帮我", "帮忙", "替我",
  "搜索", "搜一下", "查找", "查询", "查阅", "检索", "找一下", "一下", "请问", "请", "麻烦",
  "相关", "有关", "关于", "内容", "信息", "有没有", "哪些", "是什么", "什么", "我想", "想要",
  "和", "与", "的", "了", "吗", "是", "在", "从", "内", "中", "里", "我", "帮",
]);

type ScoredCandidate = { hit: KbSearchHitDto; score: number; embedding: Buffer | null };
type RankedCandidateList = { candidates: ScoredCandidate[]; weight: number };
type VectorSearchResult = { candidates: ScoredCandidate[]; indexedChunkCount: number; failed: boolean };

export class KbSearchService {
  constructor(private db: Database.Database) {}

  async search(input: SearchInput): Promise<SearchResult> {
    const start = performance.now();
    const { query, limit = 8 } = input;
    const scopes = normalizeScopes(input);
    const kbIds = scopes.map((scope) => scope.kbId);
    const queryVariants = buildSearchQueryVariants(query);
    const normalizedQuery = queryVariants.at(-1) ?? "";

    console.log(`[KB Search] ─── start ─── query="${query.slice(0, 60)}" kbIds=[${kbIds.join(",")}] limit=${limit} vectorSpaces=${scopes.filter((s) => s.embeddingModel).length}`);

    const searchableChunkCount = query.trim() && kbIds.length
      ? this.countSearchableChunks(scopes)
      : 0;
    if (!queryVariants.length || !kbIds.length || searchableChunkCount === 0) {
      const durationMs = Math.round(performance.now() - start);
      const diagnostics: KbSearchDiagnostics = {
        mode: "none",
        semanticStatus: scopes.some((scope) => scope.embeddingModel) ? "index_missing" : "not_configured",
        searchableChunkCount,
        indexedChunkCount: 0,
        keywordCandidateCount: 0,
        semanticCandidateCount: 0,
        normalizedQuery,
      };
      console.log(`[KB Search] ─── done (no searchable chunks, ${durationMs}ms)`);
      return { hits: [], durationMs, diagnostics };
    }

    // ── Step 1: Search both the original wording and a compact retrieval
    // variant. Strict AND keeps exact matches; relaxed OR recovers candidates
    // when conversational filler words are absent from document text. ──
    const t1 = performance.now();
    const ftsLists = this.ftsSearchPhase(queryVariants, scopes);
    const keywordCandidateCount = new Set(ftsLists.flatMap((list) => list.candidates.map((candidate) => candidate.hit.chunkId))).size;
    console.log(`[KB Search] Step 1/FTS5: ${keywordCandidateCount} candidates across ${ftsLists.length} query passes (${Math.round(performance.now() - t1)}ms)`);

    const vectorGroups = groupVectorScopes(scopes);
    const t2 = performance.now();
    const vectorResults = await Promise.all(vectorGroups.map(({ model, scopes: groupScopes }) =>
      this.vectorSearch(queryVariants, model, groupScopes, VECTOR_CANDIDATE_LIMIT)
    ));
    const vectorCandidates = vectorResults.flatMap((result) => result.candidates);
    const indexedChunkCount = vectorResults.reduce((sum, result) => sum + result.indexedChunkCount, 0);
    const semanticCandidateCount = new Set(vectorCandidates.map((candidate) => candidate.hit.chunkId)).size;
    console.log(`[KB Search] Step 2/vector search: ${semanticCandidateCount} candidates (${Math.round(performance.now() - t2)}ms)`);

    // ── Step 3: Reciprocal-rank fusion across all lexical and semantic lists.
    // It combines ranks without comparing unlike BM25 and cosine score scales. ──
    const rankedLists: RankedCandidateList[] = [
      ...ftsLists,
      ...vectorResults.map((result) => ({ candidates: result.candidates, weight: 1.5 })),
    ];
    const hits = rrfMerge(rankedLists, limit);
    const semanticStatus = getSemanticStatus(scopes, vectorGroups.length, vectorResults, indexedChunkCount, searchableChunkCount);
    const semanticAvailable = vectorResults.some((result) => result.indexedChunkCount > 0 && !result.failed);
    const mode: KbSearchDiagnostics["mode"] = semanticAvailable
      ? (keywordCandidateCount > 0 ? "hybrid" : "semantic")
      : (keywordCandidateCount > 0 ? "keyword" : "none");
    const diagnostics: KbSearchDiagnostics = {
      mode,
      semanticStatus,
      searchableChunkCount,
      indexedChunkCount,
      keywordCandidateCount,
      semanticCandidateCount,
      normalizedQuery,
    };

    // ── Step 4: Ensure all hits have snippets ──
    const queryWords = segmentQuery(normalizedQuery).filter((w) => /[a-zA-Z0-9㐀-鿿]/.test(w));
    for (const h of hits) {
      if (!h.snippet && h.content) {
        h.snippet = buildHighlightSnippet(h.content, queryWords);
      }
    }

    const ms = Math.round(performance.now() - start);
    console.log(`[KB Search] Step 3/merge: mode="${mode}" semanticStatus="${semanticStatus}" → ${hits.length} hits`);
    hits.forEach((h, i) => {
      console.log(`[KB Search]   #${i + 1} score=${h.score.toFixed(4)} file="${h.fileName}" chunk=${h.chunkId} seq=${h.seq} pages=${h.pageStart}-${h.pageEnd}`);
    });
    console.log(`[KB Search] ─── done (${ms}ms) ───`);
    return { hits, durationMs: ms, diagnostics };
  }

  private countSearchableChunks(scopes: SearchScope[]): number {
    const scopeFilter = buildScopeFilter(scopes, "c");
    const row = this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM kb_chunks c
      JOIN kb_files f ON f.id = c.file_id
      JOIN knowledge_bases kb ON kb.id = c.kb_id
      WHERE (${scopeFilter.sql})
        AND c.generation = f.parse_generation
        AND f.parse_generation > 0
        AND f.enabled = 1
        AND kb.enabled = 1
    `).get(...scopeFilter.params) as { count: number };
    return row.count;
  }

  // ─── FTS5 keyword search ───

  private ftsSearchPhase(
    queryVariants: string[],
    scopes: SearchScope[],
  ): RankedCandidateList[] {
    const queries = new Map<string, { query: string; words: string[]; weight: number }>();
    for (const variant of queryVariants) {
      const words = segmentQuery(variant);
      const strict = buildFtsQuery(words, "AND");
      if (strict) queries.set(strict, { query: strict, words, weight: 1 });

      const usefulWords = words.filter((word) => !LEXICAL_STOP_WORDS.has(word.toLowerCase()));
      const relaxed = buildFtsQuery(usefulWords, "OR");
      if (relaxed && !queries.has(relaxed)) queries.set(relaxed, { query: relaxed, words: usefulWords, weight: 0.65 });
    }

    const lists: RankedCandidateList[] = [];
    for (const { query, words, weight } of queries.values()) {
      console.log(`[KB Search]   ftsQuery="${query}" words=[${words.join(", ")}]`);
      const matches = this.ftsSearch(query, scopes, FTS_CANDIDATE_LIMIT, words);
      if (matches.length) lists.push({ candidates: matches, weight });
    }

    // Preserve substring matching for very short Chinese queries, where the
    // segmenter often cannot provide useful OR/AND terms.
    for (const variant of queryVariants) {
      if (!isShortCjkQuery(variant)) continue;
      const matches = this.instrFallback(variant, scopes, FTS_CANDIDATE_LIMIT);
      const knownIds = new Set(lists.flatMap((list) => list.candidates.map((candidate) => candidate.hit.chunkId)));
      const extraMatches = matches.filter((candidate) => !knownIds.has(candidate.hit.chunkId));
      if (extraMatches.length) lists.push({ candidates: extraMatches, weight: 1 });
    }
    return lists;
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
    queryVariants: string[],
    embeddingModel: EmbeddingModelConfig,
    scopes: SearchScope[],
    limit: number,
  ): Promise<VectorSearchResult> {
    const scopeFilter = buildScopeFilter(scopes, "c");
    const indexedRow = this.db.prepare(`
      SELECT COUNT(*) AS count
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
    `).get(
      ...scopeFilter.params,
      embeddingModel.modelId,
      embeddingModel.modelVersion ?? "unknown",
    ) as { count: number };
    if (!indexedRow.count) return { candidates: [], indexedChunkCount: 0, failed: false };

    // Embed the user's wording and its compact variant in one provider call.
    let queryEmbeddings: number[][];
    try {
      const result = await getEmbeddings(embeddingModel, queryVariants);
      queryEmbeddings = result.embeddings;
      console.log(`[KB Search]   query embeddings: model=${embeddingModel.modelId} queries=${queryEmbeddings.length} dimension=${result.dimension}`);
    } catch (err: any) {
      console.error(`[KB Search]   query embedding failed: ${err.message}`);
      return { candidates: [], indexedChunkCount: indexedRow.count, failed: true };
    }

    // Load all chunks with embeddings from the target KBs
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
      queryEmbeddings[0]?.length ?? 0,
    ];

    const rows = this.db.prepare(sql).all(...params) as any[];

    // Rank against both phrasings and keep the stronger semantic match. There
    // is no universal cosine cutoff across embedding models, so confidence is
    // handled by rank fusion and the answer's evidence sufficiency check.
    const scored: ScoredCandidate[] = [];
    for (const row of rows) {
      if (!row.embedding) continue;
      const chunkEmb = decodeEmbedding(row.embedding);
      const score = Math.max(...queryEmbeddings
        .filter((queryEmbedding) => queryEmbedding.length === chunkEmb.length)
        .map((queryEmbedding) => cosineSimilarity(queryEmbedding, chunkEmb)));
      // Zero cosine means no directional relationship. Keep every positive
      // candidate because a universal high cutoff rejects valid matches for
      // many embedding models and domains.
      if (!Number.isFinite(score) || score <= 0) continue;
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
    return { candidates: scored.slice(0, limit), indexedChunkCount: rows.length, failed: false };
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

function getSemanticStatus(
  scopes: SearchScope[],
  configuredGroupCount: number,
  results: VectorSearchResult[],
  indexedChunkCount: number,
  searchableChunkCount: number,
): KbSearchDiagnostics["semanticStatus"] {
  if (configuredGroupCount === 0) return "not_configured";
  const failedGroupCount = results.filter((result) => result.failed).length;
  if (failedGroupCount === configuredGroupCount) return "failed";
  if (indexedChunkCount === 0) return "index_missing";
  if (
    failedGroupCount > 0 ||
    scopes.some((scope) => !scope.embeddingModel) ||
    indexedChunkCount < searchableChunkCount
  ) return "partial";
  return "ready";
}

// ─── RRF (Reciprocal Rank Fusion) ───

function rrfMerge(
  resultLists: RankedCandidateList[],
  limit: number,
): KbSearchHitDto[] {
  // Compute RRF score for each chunk
  const rrfScores = new Map<number, { hit: KbSearchHitDto; rrfScore: number }>();

  for (const list of resultLists) {
    [...list.candidates].sort((a, b) => b.score - a.score).forEach((candidate, rank) => {
      const chunkId = candidate.hit.chunkId;
      const existing = rrfScores.get(chunkId);
      const rrf = list.weight / (RRF_K + rank + 1);
      if (existing) {
        existing.rrfScore += rrf;
        if (candidate.hit.vectorScore !== undefined) existing.hit.vectorScore = candidate.hit.vectorScore;
        if (candidate.hit.keywordScore !== undefined) existing.hit.keywordScore = candidate.hit.keywordScore;
      } else {
        rrfScores.set(chunkId, { hit: candidate.hit, rrfScore: rrf });
      }
    });
  }

  // Sort by RRF score and return top-K
  return [...rrfScores.values()]
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .slice(0, limit)
    .map((r) => ({ ...r.hit, score: r.rrfScore }));
}

// ─── Helpers ───

function buildFtsQuery(words: string[], operator: "AND" | "OR"): string {
  if (!words.length) return "";

  const terms = words.map((w) => {
    const escaped = w.replace(/"/g, '""');
    if (/[㐀-鿿]/.test(w)) return escaped;
    return `"${escaped}"`;
  });
  return terms.join(` ${operator} `);
}

/** Check if query is a short CJK string (≤2 characters) — needs instr fallback. */
function isShortCjkQuery(query: string): boolean {
  const trimmed = query.trim();
  const chars = [...trimmed]; // spread handles surrogate pairs
  if (chars.length > 2) return false;
  return /[㐀-鿿]/.test(trimmed);
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
