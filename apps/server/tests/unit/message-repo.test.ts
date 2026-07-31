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

  it("finalizes dangling tool calls after an interrupted process", () => {
    messages.append({
      sessionId,
      role: "assistant",
      content: "",
      metadata: {
        toolCalls: [{
          toolCallId: "call-1",
          name: "bash",
          args: { command: "pnpm dev" },
          status: "running",
        }],
        messageParts: [{
          type: "toolCall",
          id: "call-1",
          name: "bash",
          arguments: { command: "pnpm dev" },
          status: "running",
        }],
      },
    });

    expect(messages.finishDanglingToolCalls("Agent stopped")).toBe(1);

    const metadata = messages.listBySession(sessionId)[0]!.metadata!;
    expect(metadata.toolCalls).toEqual([
      expect.objectContaining({
        toolCallId: "call-1",
        status: "complete",
        result: expect.objectContaining({ isError: true }),
      }),
    ]);
    expect(metadata.messageParts).toEqual([
      expect.objectContaining({
        id: "call-1",
        status: "complete",
        result: expect.objectContaining({ isError: true }),
      }),
    ]);
  });

  it("does not rewrite completed tool calls that already have a result", () => {
    messages.append({
      sessionId,
      role: "assistant",
      content: "",
      metadata: {
        toolCalls: [{
          toolCallId: "call-1",
          name: "read",
          args: { path: "README.md" },
          status: "complete",
          result: { content: "ok" },
        }],
      },
    });

    expect(messages.finishDanglingToolCalls("Agent stopped")).toBe(0);
  });
});
