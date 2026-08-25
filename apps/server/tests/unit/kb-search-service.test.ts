import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeEmbedding } from "../../src/kb/embedding-client.js";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations.js";
import { KnowledgeBaseRepository } from "../../src/db/repositories/knowledge-base.js";
import { KbFileRepository } from "../../src/db/repositories/kb-file.js";
import { KbChunkRepository } from "../../src/db/repositories/kb-chunk.js";
import { KbSearchService } from "../../src/kb/search-service.js";

describe("KbSearchService", () => {
  let db: Database.Database;
  let kbs: KnowledgeBaseRepository;
  let files: KbFileRepository;
  let chunks: KbChunkRepository;
  let search: KbSearchService;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
    kbs = new KnowledgeBaseRepository(db);
    files = new KbFileRepository(db);
    chunks = new KbChunkRepository(db);
    search = new KbSearchService(db);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  function addFile(kbId: string, name: string, content: string): string {
    const file = files.create({ kbId, name, ext: "txt", source: "created", size: content.length, storagePath: `${kbId}/${name}` });
    const generation = 1;
    chunks.insert({ kbId, fileId: file.id, generation, seq: 0, titlePath: null, pageStart: null, pageEnd: null, content, charCount: content.length });
    files.updateStatus(file.id, { status: "ready", parseGeneration: generation, charCount: content.length, chunkCount: 1, lastParsedAt: Date.now() });
    return file.id;
  }

  function mockQueryEmbedding(vector: number[]): void {
    vi.stubGlobal("fetch", vi.fn(async () => {
      const body = JSON.stringify({ data: [{ embedding: vector, index: 0 }], model: "test" });
      return new Response(body, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }));
  }

  it("ranks the stronger BM25 match first", async () => {
    const kb = kbs.create({ name: "排序测试" });
    addFile(kb.id, "weak.txt", "火星基地的普通说明");
    addFile(kb.id, "strong.txt", "火星基地 火星基地 火星基地的建设计划");

    const result = await search.search({ query: "火星基地", scopes: [{ kbId: kb.id }], limit: 10 });

    expect(result.hits[0]?.fileName).toBe("strong.txt");
    expect(result.hits[0]?.keywordScore).toBeGreaterThan(result.hits[1]?.keywordScore ?? 0);
  });

  it("applies file filters inside each KB scope", async () => {
    const kbA = kbs.create({ name: "A" });
    const kbB = kbs.create({ name: "B" });
    addFile(kbA.id, "all-a.txt", "企业知识检索范围测试");
    const selectedB = addFile(kbB.id, "selected-b.txt", "企业知识检索范围测试");
    addFile(kbB.id, "excluded-b.txt", "企业知识检索范围测试");

    const result = await search.search({
      query: "企业知识",
      scopes: [{ kbId: kbA.id }, { kbId: kbB.id, fileIds: [selectedB] }],
      limit: 10,
    });

    expect(result.hits.map((hit) => hit.fileName).sort()).toEqual(["all-a.txt", "selected-b.txt"]);
  });

  it("does not duplicate an FTS hit in the short-query fallback", async () => {
    const kb = kbs.create({ name: "短查询去重" });
    const fileId = addFile(kb.id, "诗歌.txt", "暮色轻抚山岗，晚风携着花香。");
    const chunk = chunks.listByFile(fileId, 1)[0]!;

    const result = await search.search({ query: "暮色", scopes: [{ kbId: kb.id }], limit: 5 });

    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]?.chunkId).toBe(chunk.id);
    expect(result.hits[0]?.score).toBeGreaterThan(0);
  });

  it("never compares vectors from another model space", async () => {
    const kb = kbs.create({ name: "向量隔离" });
    const fileId = addFile(kb.id, "only-wrong-space.txt", "与查询没有关键词重合");
    const chunk = chunks.listByFile(fileId, 1)[0]!;
    chunks.upsertVector({
      chunkId: chunk.id, vectorSpace: "text", modality: "text",
      modelId: "model-b", modelVersion: "v1", dimension: 2,
      embedding: encodeEmbedding([1, 0]),
    });
    mockQueryEmbedding([1, 0]);

    const result = await search.search({
      query: "完全不同的问题",
      scopes: [{
        kbId: kb.id,
        embeddingModel: { apiBaseUrl: "https://example.test/v1", apiKey: "test", modelId: "model-a", modelVersion: "v1" },
      }],
    });

    expect(result.hits).toEqual([]);
  });

  it("drops vector results below the relevance threshold", async () => {
    const kb = kbs.create({ name: "相关度门槛" });
    const fileId = addFile(kb.id, "orthogonal.txt", "无关键词重合的内容");
    const chunk = chunks.listByFile(fileId, 1)[0]!;
    chunks.upsertVector({
      chunkId: chunk.id, vectorSpace: "text", modality: "text",
      modelId: "model-a", modelVersion: "v1", dimension: 2,
      embedding: encodeEmbedding([0, 1]),
    });
    mockQueryEmbedding([1, 0]);

    const result = await search.search({
      query: "完全不同的问题",
      scopes: [{
        kbId: kb.id,
        embeddingModel: { apiBaseUrl: "https://example.test/v1", apiKey: "test", modelId: "model-a", modelVersion: "v1" },
      }],
    });

    expect(result.hits).toEqual([]);
  });
});
