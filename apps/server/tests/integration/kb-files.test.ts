import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildApp } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";
import { openDatabase } from "../../src/db/sqlite.js";
import { KnowledgeBaseRepository } from "../../src/db/repositories/knowledge-base.js";
import { KbFileRepository } from "../../src/db/repositories/kb-file.js";
import { KbChunkRepository } from "../../src/db/repositories/kb-chunk.js";
import { createKbFilesRoutes } from "../../src/routes/kb-files.js";

describe("knowledge base file lifecycle", () => {
  let root: string;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-kb-files-"));
    process.env.PI_WEB_UI_ROOT = root;
    const config = loadConfig();
    const db = openDatabase(config.dbPath);
    app = await buildApp(config, {
      db, config,
      knowledgeBases: new KnowledgeBaseRepository(db),
      kbFiles: new KbFileRepository(db),
      kbChunks: new KbChunkRepository(db),
    });
    const parseJobs = { enqueue() {} } as any;
    await app.register(createKbFilesRoutes(parseJobs, config.kbFilesDir), { prefix: "/api" });
  });

  afterEach(async () => {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("deletes the physical asset together with its database record", async () => {
    const kb = app.knowledgeBases.create({ name: "删除测试" });
    const relativePath = `${kb.id}/asset.txt`;
    const fullPath = path.join(app.config.kbFilesDir, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, "待删除内容");
    const file = app.kbFiles.create({
      kbId: kb.id,
      name: "asset.txt",
      ext: "txt",
      source: "created",
      size: 15,
      storagePath: relativePath,
    });

    const response = await app.inject({ method: "DELETE", url: `/api/kb-files/${file.id}` });

    expect(response.statusCode).toBe(204);
    expect(app.kbFiles.findById(file.id)).toBeNull();
    expect(fs.existsSync(fullPath)).toBe(false);
  });
});
