import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runMigrations } from "../../src/db/migrations.js";
import { KnowledgeBaseRepository } from "../../src/db/repositories/knowledge-base.js";
import { KbFileRepository } from "../../src/db/repositories/kb-file.js";
import { KbChunkRepository } from "../../src/db/repositories/kb-chunk.js";
import { ModelRepository } from "../../src/db/repositories/model.js";
import { ParsePipeline } from "../../src/kb/parse-pipeline.js";

describe("ParsePipeline", () => {
  const tempDirs: string[] = [];
  afterEach(() => tempDirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

  it("keeps the active generation searchable when a reparse fails", async () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-kb-parse-"));
    tempDirs.push(root);
    const kbs = new KnowledgeBaseRepository(db);
    const files = new KbFileRepository(db);
    const chunks = new KbChunkRepository(db);
    const models = new ModelRepository(db);
    const kb = kbs.create({ name: "版本测试" });
    const file = files.create({ kbId: kb.id, name: "missing.txt", ext: "txt", source: "created", size: 8, storagePath: `${kb.id}/missing.txt` });
    chunks.insert({ kbId: kb.id, fileId: file.id, generation: 1, seq: 0, titlePath: null, pageStart: null, pageEnd: null, content: "仍然可用的旧知识", charCount: 8 });
    files.updateStatus(file.id, { status: "ready", parseGeneration: 1, charCount: 8, chunkCount: 1, lastParsedAt: Date.now() });

    const pipeline = new ParsePipeline(db, files, chunks, root, kbs, models);
    const result = await pipeline.parseFile(file.id);

    expect(result.success).toBe(false);
    expect(files.findById(file.id)?.parseGeneration).toBe(1);
    expect(chunks.listByFile(file.id, 1)).toHaveLength(1);
  });

  it("switches the active revision atomically and retains historical segments", async () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-kb-revision-"));
    tempDirs.push(root);
    const kbs = new KnowledgeBaseRepository(db);
    const files = new KbFileRepository(db);
    const chunks = new KbChunkRepository(db);
    const models = new ModelRepository(db);
    const kb = kbs.create({ name: "活动版本测试" });
    const relativePath = `${kb.id}/source.txt`;
    fs.mkdirSync(path.dirname(path.join(root, relativePath)), { recursive: true });
    fs.writeFileSync(path.join(root, relativePath), "这是新版本中可以检索的内容");
    const file = files.create({ kbId: kb.id, name: "source.txt", ext: "txt", source: "created", size: 14, storagePath: relativePath });
    chunks.insert({ kbId: kb.id, fileId: file.id, generation: 1, seq: 0, titlePath: null, pageStart: null, pageEnd: null, content: "旧版本内容", charCount: 6 });
    files.updateStatus(file.id, { status: "ready", parseGeneration: 1, activeRevisionId: "old-revision", chunkCount: 1 });

    const result = await new ParsePipeline(db, files, chunks, root, kbs, models).parseFile(file.id);
    const updated = files.findById(file.id);

    expect(result.success).toBe(true);
    expect(updated?.parseGeneration).toBe(2);
    expect(updated?.activeRevisionId).toBeTruthy();
    expect(chunks.listByFile(file.id, 1)).toHaveLength(1);
    expect(chunks.listByFile(file.id, 2)).toHaveLength(1);
    expect(db.prepare("SELECT status FROM kb_asset_revisions WHERE id = ?").get(updated?.activeRevisionId)).toEqual({ status: "ready" });
  });
});
