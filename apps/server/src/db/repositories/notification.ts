import type Database from "better-sqlite3";
import type { NotificationDto } from "@pi-web-ui/shared";
import { ulid } from "../../util/ulid.js";

type NotificationType = NotificationDto["type"];

type Row = {
  id: string;
  task_id: string;
  project_id: string;
  session_id: string;
  message_id: string | null;
  type: NotificationType;
  title: string;
  body: string;
  is_read: number;
  created_at: number;
  read_at: number | null;
};

export interface SettlementInput {
  taskId: string;
  projectId: string;
  sessionId: string;
  messageId?: string;
  type: NotificationType;
  title: string;
  body: string;
  createdAt?: number;
}

function toDto(row: Row): NotificationDto {
  return {
    id: row.id,
    taskId: row.task_id,
    projectId: row.project_id,
    sessionId: row.session_id,
    messageId: row.message_id,
    type: row.type,
    title: row.title,
    body: row.body,
    isRead: row.is_read === 1,
    createdAt: row.created_at,
    readAt: row.read_at,
  };
}

export class NotificationRepository {
  constructor(private db: Database.Database) {}

  recordSettlement(input: SettlementInput): {
    created: boolean;
    notification: NotificationDto;
    unreadCount: number;
  } {
    return this.db.transaction(() => {
      const existing = this.findByTaskId(input.taskId);
      if (existing) {
        return {
          created: false,
          notification: existing,
          unreadCount: this.sessionUnreadCount(input.sessionId),
        };
      }

      const session = this.db.prepare(
        "SELECT id FROM sessions WHERE id = ? AND deleted_at IS NULL",
      ).get(input.sessionId) as { id: string } | undefined;
      if (!session) throw new Error("session not found");

      const id = ulid();
      const createdAt = input.createdAt ?? Date.now();
      this.db.prepare(`
        INSERT INTO notifications (
          id, task_id, project_id, session_id, message_id, type,
          title, body, is_read, created_at, read_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NULL)
      `).run(
        id, input.taskId, input.projectId, input.sessionId, input.messageId ?? null,
        input.type, input.title, input.body, createdAt,
      );
      this.db.prepare(
        "UPDATE sessions SET unread_count = unread_count + 1 WHERE id = ?",
      ).run(input.sessionId);

      return {
        created: true,
        notification: this.findByTaskId(input.taskId)!,
        unreadCount: this.sessionUnreadCount(input.sessionId),
      };
    })();
  }

  markSessionRead(sessionId: string, messageId?: string): number {
    return this.db.transaction(() => {
      const now = Date.now();
      this.db.prepare(`
        UPDATE notifications
        SET is_read = 1, read_at = COALESCE(read_at, ?)
        WHERE session_id = ? AND is_read = 0
      `).run(now, sessionId);
      this.db.prepare(`
        UPDATE sessions
        SET unread_count = 0,
            last_read_message_id = COALESCE(?, last_read_message_id)
        WHERE id = ? AND deleted_at IS NULL
      `).run(messageId ?? null, sessionId);
      return this.totalUnreadCount();
    })();
  }

  totalUnreadCount(): number {
    const row = this.db.prepare(`
      SELECT COALESCE(SUM(unread_count), 0) AS count
      FROM sessions
      WHERE deleted_at IS NULL
    `).get() as { count: number };
    return row.count;
  }

  findByTaskId(taskId: string): NotificationDto | null {
    const row = this.db.prepare(
      "SELECT * FROM notifications WHERE task_id = ?",
    ).get(taskId) as Row | undefined;
    return row ? toDto(row) : null;
  }

  private sessionUnreadCount(sessionId: string): number {
    const row = this.db.prepare(
      "SELECT unread_count AS count FROM sessions WHERE id = ?",
    ).get(sessionId) as { count: number } | undefined;
    return row?.count ?? 0;
  }
}
