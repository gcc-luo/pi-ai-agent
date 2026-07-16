import type Database from "better-sqlite3";
import { KbSearchHitDto } from "@pi-web-ui/shared";
import { decodeEmbedding, cosineSimilarity, EmbeddingModelConfig, getEmbedding } from "./embedding-client.js";

export interface SearchInput {
  query: string;
  kbIds: string[];
  fileIds?: string[];
  limit?: number;
  embeddingModel?: EmbeddingModelConfig;
}

export interface SearchResult {
  hits: KbSearchHitDto[];
  durationMs: number;
}

const CANDIDATE_LIMIT = 50;  // Fetch more candidates for hybrid ranking

export class KbSearchService {
  constructor(private db: Database.Database) {}

  async search(input: SearchInput): Promise<SearchResult> {
    const start = performance.now();
    const { query, kbIds, fileIds, limit = 8, embeddingModel } = input;

    console.log(`[KB Search] start: query="${query.slice(0, 60)}" kbIds=[${kbIds.join(",")}] fileIds=${fileIds ? `[${fileIds.join(",")}]` : "all"} limit=${limit} embedding=${!!embeddingModel}`);

    if (!query.trim() || !kbIds.length) {
      console.log(`[KB Search] skipped: empty query or no kbIds`);
      return { hits: [], durationMs: 0 };
    }

    const ftsQuery = buildFtsQuery(query);
    if (!ftsQuery) {
      console.log(`[KB Search] skipped: empty ftsQuery after tokenization`);
      return { hits: [], durationMs: 0 };
    }

    console.log(`[KB Search] ftsQuery: "${ftsQuery}"`);

    // Phase 1: FTS5 keyword search (get candidates)
    const candidates = this.ftsSearch(ftsQuery, kbIds, fileIds, CANDIDATE_LIMIT);
    console.log(`[KB Search] FTS candidates: ${candidates.length}`);

    if (candidates.length === 0) {
      return { hits: [], durationMs: Math.round(performance.now() - start) };
    }

    // Phase 2: Semantic ranking with embeddings (if model configured)
    let hits: KbSearchHitDto[];

    if (embeddingModel) {
      hits = await this.semanticRank(candidates, query, embeddingModel, limit);
    } else {
      // Pure FTS5 ranking
      hits = candidates
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((c) => c.hit);
    }

    console.log(`[KB Search] final hits: ${hits.length}`);
    return { hits, durationMs: Math.round(performance.now() - start) };
  }

  private ftsSearch(
    ftsQuery: string,
    kbIds: string[],
    fileIds: string[] | undefined,
    limit: number
  ): { hit: KbSearchHitDto; score: number; embedding: Buffer | null }[] {
    const kbPlaceholders = kbIds.map(() => "?").join(",");
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
        c.embedding,
        bm25(kb_chunks_fts) AS score,
        snippet(kb_chunks_fts, 0, '<mark>', '</mark>', '…', 24) AS snippet,
        kb.name AS kbName,
        f.name AS fileName
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

    sql += ` ORDER BY bm25(kb_chunks_fts) DESC LIMIT ?`;
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as any[];

    return rows.map((row) => ({
      hit: {
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
      },
      score: row.score,
      embedding: row.embedding,
    }));
  }

  private async semanticRank(
    candidates: { hit: KbSearchHitDto; score: number; embedding: Buffer | null }[],
    query: string,
    embeddingModel: EmbeddingModelConfig,
    limit: number
  ): Promise<KbSearchHitDto[]> {
    // Generate query embedding
    let queryEmbedding: number[];
    try {
      queryEmbedding = await getEmbedding(embeddingModel, query);
      console.log(`[KB Search] query embedding: dimension=${queryEmbedding.length}`);
    } catch (err: any) {
      console.error(`[KB Search] query embedding failed: ${err.message}`);
      // Fall back to pure FTS ranking
      return candidates
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((c) => c.hit);
    }

    // Compute semantic similarity for candidates that have embeddings
    const scored: { hit: KbSearchHitDto; hybridScore: number }[] = [];

    for (const candidate of candidates) {
      const bm25Score = candidate.score;

      let semanticScore = 0;
      if (candidate.embedding) {
        const chunkEmbedding = decodeEmbedding(candidate.embedding);
        semanticScore = cosineSimilarity(queryEmbedding, chunkEmbedding);
      }

      // Hybrid scoring: 0.4 * BM25 + 0.6 * semantic
      // Normalize BM25 (can be negative) to roughly [0, 1] using sigmoid-like transform
      const normalizedBm25 = 1 / (1 + Math.exp(-bm25Score / 5));  // Sigmoid
      const normalizedSemantic = (semanticScore + 1) / 2;  // [-1, 1] → [0, 1]

      const hybridScore = 0.4 * normalizedBm25 + 0.6 * normalizedSemantic;

      scored.push({
        hit: {
          ...candidate.hit,
          score: hybridScore,
        },
        hybridScore,
      });
    }

    // Sort by hybrid score and return top-K
    return scored
      .sort((a, b) => b.hybridScore - a.hybridScore)
      .slice(0, limit)
      .map((s) => s.hit);
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
