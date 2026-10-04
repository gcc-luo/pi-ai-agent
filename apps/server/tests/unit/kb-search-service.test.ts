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
      const body = JSON.stringify({
        data: [{ embedding: vector, index: 0 }],
        model: "test",
      });
      return new Response(body, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }));
  }

  function mockQueryEmbeddingsForText(resolve: (text: string) => number[]): void {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { input: string[] };
      const body = JSON.stringify({
        data: request.input.map((text, index) => ({ embedding: resolve(text), index })),
        model: "test",
      });
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
    expect(result.diagnostics.semanticStatus).toBe("index_missing");
  });

  it("does not return vectors with no positive semantic alignment", async () => {
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

  it("keeps relevant low-score vectors instead of applying a universal high cutoff", async () => {
    const kb = kbs.create({ name: "低相似度召回" });
    const fileId = addFile(kb.id, "related.txt", "描写春日景色的古典诗作");
    const chunk = chunks.listByFile(fileId, 1)[0]!;
    chunks.upsertVector({
      chunkId: chunk.id, vectorSpace: "text", modality: "text",
      modelId: "model-a", modelVersion: "v1", dimension: 2,
      embedding: encodeEmbedding([0.2, Math.sqrt(0.96)]),
    });
    mockQueryEmbedding([1, 0]);

    const result = await search.search({
      query: "寻找春季主题的诗",
      scopes: [{
        kbId: kb.id,
        embeddingModel: { apiBaseUrl: "https://example.test/v1", apiKey: "test", modelId: "model-a", modelVersion: "v1" },
      }],
    });

    expect(result.hits[0]?.chunkId).toBe(chunk.id);
    expect(result.hits[0]?.vectorScore).toBeCloseTo(0.2);
  });

  it("uses both original and compact phrasings for semantic retrieval", async () => {
    const kb = kbs.create({ name: "自然语言语义检索" });
    const fileId = addFile(kb.id, "poems.txt", "暮春时分，古人留下许多关于花开与离别的诗作。");
    const chunk = chunks.listByFile(fileId, 1)[0]!;
    chunks.upsertVector({
      chunkId: chunk.id, vectorSpace: "text", modality: "text",
      modelId: "model-a", modelVersion: "v1", dimension: 2,
      embedding: encodeEmbedding([1, 0]),
    });
    mockQueryEmbeddingsForText((text) => text.includes("帮我搜索") ? [0, 1] : [1, 0]);

    const result = await search.search({
      query: "帮我搜索一下知识库中和春天相关的诗歌",
      scopes: [{
        kbId: kb.id,
        embeddingModel: { apiBaseUrl: "https://example.test/v1", apiKey: "test", modelId: "model-a", modelVersion: "v1" },
      }],
    });

    expect(result.hits[0]?.chunkId).toBe(chunk.id);
    expect(result.diagnostics.normalizedQuery).toContain("春天");
    expect(result.diagnostics.semanticStatus).toBe("ready");
    expect(result.diagnostics.mode).toBe("semantic");
  });

  it("reports keyword fallback when semantic search is not configured", async () => {
    const kb = kbs.create({ name: "关键词回退状态" });
    addFile(kb.id, "春天.txt", "春天来了，花开了。");

    const result = await search.search({ query: "帮我搜索知识库中春天的内容", scopes: [{ kbId: kb.id }] });

    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.diagnostics.semanticStatus).toBe("not_configured");
    expect(result.diagnostics.mode).toBe("keyword");
  });

  it("reports embedding failures while preserving keyword results", async () => {
    const kb = kbs.create({ name: "语义服务故障回退" });
    const fileId = addFile(kb.id, "spring.txt", "春天来了，花开了。");
    const chunk = chunks.listByFile(fileId, 1)[0]!;
    chunks.upsertVector({
      chunkId: chunk.id, vectorSpace: "text", modality: "text",
      modelId: "model-a", modelVersion: "v1", dimension: 2,
      embedding: encodeEmbedding([1, 0]),
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unavailable", { status: 503 })));

    const result = await search.search({
      query: "春天",
      scopes: [{
        kbId: kb.id,
        embeddingModel: { apiBaseUrl: "https://example.test/v1", apiKey: "test", modelId: "model-a", modelVersion: "v1" },
      }],
    });

    expect(result.hits[0]?.chunkId).toBe(chunk.id);
    expect(result.diagnostics.semanticStatus).toBe("failed");
    expect(result.diagnostics.mode).toBe("keyword");
  });

  it("distinguishes a knowledge base with no searchable chunks", async () => {
    const kb = kbs.create({ name: "空知识库" });

    const result = await search.search({ query: "春天的诗歌", scopes: [{ kbId: kb.id }] });

    expect(result.hits).toEqual([]);
    expect(result.diagnostics.searchableChunkCount).toBe(0);
    expect(result.diagnostics.mode).toBe("none");
  });
});
