import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations.js";
import { ProjectRepository } from "../../src/db/repositories/project.js";
import { SessionRepository } from "../../src/db/repositories/session.js";
import { MessageRepository } from "../../src/db/repositories/message.js";

describe("MessageRepository", () => {
  let db: Database.Database;
  let messages: MessageRepository;
  let sessionId: string;
  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    const projects = new ProjectRepository(db);
    const sessions = new SessionRepository(db);
    const p = projects.create({ name: "p", workdir: "/tmp/p" });
    sessionId = sessions.create({ projectId: p.id }).id;
    messages = new MessageRepository(db);
  });

  it("appends messages with increasing seq", () => {
    const m1 = messages.append({ sessionId, role: "user", content: "hi" });
    const m2 = messages.append({ sessionId, role: "assistant", content: "hello" });
    expect(m1.seq).toBe(1);
    expect(m2.seq).toBe(2);
  });

  it("lists messages in seq order", () => {
    messages.append({ sessionId, role: "user", content: "hi" });
    messages.append({ sessionId, role: "assistant", content: "hello" });
    const list = messages.listBySession(sessionId);
    expect(list.map((m) => m.content)).toEqual(["hi", "hello"]);
  });
});
