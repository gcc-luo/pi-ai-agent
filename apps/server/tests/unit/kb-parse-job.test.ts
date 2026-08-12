import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations.js";
import { KnowledgeBaseRepository } from "../../src/db/repositories/knowledge-base.js";
import { KbFileRepository } from "../../src/db/repositories/kb-file.js";
import { KbParseJobRepository } from "../../src/db/repositories/kb-parse-job.js";

describe("KbParseJobRepository", () => {
  it("recovers an interrupted job after restart", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
    const kb = new KnowledgeBaseRepository(db).create({ name: "任务恢复" });
    const files = new KbFileRepository(db);
    const file = files.create({ kbId: kb.id, name: "a.txt", ext: "txt", source: "created", size: 1, storagePath: `${kb.id}/a.txt` });
    const jobs = new KbParseJobRepository(db);
    jobs.enqueue(file.id);
    expect(jobs.claimNext()?.fileId).toBe(file.id);

    const recovered = jobs.recoverInterrupted();

    expect(recovered).toBe(1);
    expect(jobs.claimNext()?.fileId).toBe(file.id);
  });

  it("does not lose a reparse requested while the file is running", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
    const kb = new KnowledgeBaseRepository(db).create({ name: "重复解析" });
    const file = new KbFileRepository(db).create({ kbId: kb.id, name: "a.txt", ext: "txt", source: "created", size: 1, storagePath: `${kb.id}/a.txt` });
    const jobs = new KbParseJobRepository(db);
    jobs.enqueue(file.id);
    expect(jobs.claimNext()).not.toBeNull();
    jobs.enqueue(file.id);

    jobs.complete(file.id);

    expect(jobs.claimNext()?.fileId).toBe(file.id);
  });
});
