import type Database from "better-sqlite3";
import { MessageDto } from "@pi-web-ui/shared";
import { ulid } from "../../util/ulid.js";

type Row = {
  id: string; session_id: string; role: "user" | "assistant" | "tool";
  content: string | null; metadata: string | null;
  created_at: number; seq: number;
};

function toDto(r: Row): MessageDto {
  return {
    id: r.id, sessionId: r.session_id, role: r.role, content: r.content,
    metadata: r.metadata ? JSON.parse(r.metadata) : null,
    createdAt: r.created_at, seq: r.seq,
  };
}

export class MessageRepository {
  constructor(private db: Database.Database) {}

  append(input: { sessionId: string; role: "user" | "assistant" | "tool"; content: string; metadata?: Record<string, unknown>; createdAt?: number }): MessageDto {
    const id = ulid();
    const createdAt = input.createdAt ?? Date.now();
    const seqRow = this.db.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM messages WHERE session_id = ?").get(input.sessionId) as { next: number };
    this.db.prepare(`
      INSERT INTO messages (id, session_id, role, content, metadata, created_at, seq)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.sessionId, input.role, input.content, input.metadata ? JSON.stringify(input.metadata) : null, createdAt, seqRow.next);
    return {
      id, sessionId: input.sessionId, role: input.role, content: input.content,
      metadata: input.metadata ?? null, createdAt, seq: seqRow.next,
    };
  }

  listBySession(sessionId: string): MessageDto[] {
    return (this.db.prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY seq ASC").all(sessionId) as Row[]).map(toDto);
  }

  updateMetadata(id: string, metadata: Record<string, unknown>): void {
    this.db.prepare("UPDATE messages SET metadata = ? WHERE id = ?").run(JSON.stringify(metadata), id);
  }

  replaceContentAndMetadata(id: string, content: string, metadata: Record<string, unknown>): void {
    this.db.prepare("UPDATE messages SET content = ?, metadata = ? WHERE id = ?")
      .run(content, JSON.stringify(metadata), id);
  }

  updateCreatedAt(id: string, createdAt: number): void {
    this.db.prepare("UPDATE messages SET created_at = ? WHERE id = ?").run(createdAt, id);
  }
}
