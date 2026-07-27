import type Database from "better-sqlite3";

export type ChannelConversation = {
  channelId: string;
  userId: string;
  sessionId: string;
  updatedAt: number;
};

/** Persistent mapping from a channel participant to one Pi session. */
export class ChannelConversationRepository {
  constructor(private db: Database.Database) {}

  find(channelId: string, userId: string): ChannelConversation | null {
    const row = this.db.prepare(
      "SELECT channel_id, user_id, session_id, updated_at FROM channel_conversations WHERE channel_id = ? AND user_id = ?",
    ).get(channelId, userId) as { channel_id: string; user_id: string; session_id: string; updated_at: number } | undefined;
    return row ? { channelId: row.channel_id, userId: row.user_id, sessionId: row.session_id, updatedAt: row.updated_at } : null;
  }

  bind(channelId: string, userId: string, sessionId: string): void {
    this.db.prepare(`
      INSERT INTO channel_conversations (channel_id, user_id, session_id, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(channel_id, user_id)
      DO UPDATE SET session_id = excluded.session_id, updated_at = excluded.updated_at
    `).run(channelId, userId, sessionId, Date.now());
  }

  touch(channelId: string, userId: string): void {
    this.db.prepare(
      "UPDATE channel_conversations SET updated_at = ? WHERE channel_id = ? AND user_id = ?",
    ).run(Date.now(), channelId, userId);
  }

  list(channelId: string): ChannelConversation[] {
    return (this.db.prepare(
      "SELECT channel_id, user_id, session_id, updated_at FROM channel_conversations WHERE channel_id = ? ORDER BY updated_at DESC",
    ).all(channelId) as { channel_id: string; user_id: string; session_id: string; updated_at: number }[])
      .map((row) => ({ channelId: row.channel_id, userId: row.user_id, sessionId: row.session_id, updatedAt: row.updated_at }));
  }
}
