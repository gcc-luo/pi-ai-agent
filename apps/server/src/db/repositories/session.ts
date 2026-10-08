import type Database from "better-sqlite3";
import { SessionAuthorizationMode, SessionDto, SessionStatus } from "@pi-web-ui/shared";
import { ulid } from "../../util/ulid.js";

type Row = {
  id: string; project_id: string; title: string | null; parent_id: string | null;
  expert_id: string | null; authorization_mode: SessionAuthorizationMode;
  project_authorization_mode: SessionAuthorizationMode;
  status: SessionStatus; pi_session_ref: string | null;
  browser_enabled: number;
  created_at: number; updated_at: number; last_active_at: number | null;
  unread_count: number; last_read_message_id: string | null;
  deleted_at: number | null;
};

function toDto(r: Row): SessionDto {
  return {
    id: r.id, projectId: r.project_id, title: r.title, parentId: r.parent_id, expertId: r.expert_id,
    authorizationMode: r.project_authorization_mode,
    selectedPluginIds: [],
    browserEnabled: r.browser_enabled === 1,
    status: r.status, createdAt: r.created_at, updatedAt: r.updated_at, lastActiveAt: r.last_active_at,
    unreadCount: r.unread_count, lastReadMessageId: r.last_read_message_id,
    deletedAt: r.deleted_at,
  };
}

export class SessionRepository {
  constructor(private db: Database.Database) {}

  create(input: { projectId: string; parentId?: string; title?: string; expertId?: string }): SessionDto {
    const id = ulid();
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO sessions (id, project_id, title, parent_id, expert_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(id, input.projectId, input.title ?? null, input.parentId ?? null, input.expertId ?? null, now, now);
    return this.findById(id)!;
  }

  findById(id: string): SessionDto | null {
    const r = this.db.prepare(`
      SELECT sessions.*, projects.authorization_mode AS project_authorization_mode
      FROM sessions
      JOIN projects ON projects.id = sessions.project_id
      WHERE sessions.id = ? AND sessions.deleted_at IS NULL
    `).get(id) as Row | undefined;
    return r ? this.withPlugins(toDto(r)) : null;
  }

  listByProject(projectId: string): SessionDto[] {
    return (this.db.prepare(`
      SELECT sessions.*, projects.authorization_mode AS project_authorization_mode
      FROM sessions
      JOIN projects ON projects.id = sessions.project_id
      WHERE sessions.project_id = ? AND sessions.deleted_at IS NULL
      ORDER BY sessions.updated_at DESC
    `).all(projectId) as Row[])
      .map((row) => this.withPlugins(toDto(row)));
  }

  children(parentId: string): SessionDto[] {
    return (this.db.prepare(`
      SELECT sessions.*, projects.authorization_mode AS project_authorization_mode
      FROM sessions
      JOIN projects ON projects.id = sessions.project_id
      WHERE sessions.parent_id = ? AND sessions.deleted_at IS NULL
    `).all(parentId) as Row[])
      .map((row) => this.withPlugins(toDto(row)));
  }

  touch(id: string, status: SessionStatus, opts?: { title?: string; piSessionRef?: string }): void {
    const now = Date.now();
    const cur = this.findById(id);
    if (!cur) throw new Error("session not found");
    this.db.prepare(`
      UPDATE sessions
      SET status = ?, last_active_at = ?, updated_at = ?, title = COALESCE(?, title), pi_session_ref = COALESCE(?, pi_session_ref)
      WHERE id = ?
    `).run(status, now, now, opts?.title ?? null, opts?.piSessionRef ?? null, id);
  }

  setStatus(id: string, status: SessionStatus): void {
    this.db.prepare("UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?").run(status, Date.now(), id);
  }

  update(id: string, patch: { title: string | null }): void {
    const cur = this.findById(id);
    if (!cur) throw new Error("session not found");
    this.db.prepare("UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?")
      .run(patch.title, Date.now(), id);
  }

  setExpert(id: string, expertId: string | null): void {
    const cur = this.findById(id);
    if (!cur) throw new Error("session not found");
    this.db.prepare("UPDATE sessions SET expert_id = ?, updated_at = ? WHERE id = ?")
      .run(expertId, Date.now(), id);
  }

  setAuthorizationMode(id: string, mode: SessionAuthorizationMode): void {
    const cur = this.findById(id);
    if (!cur) throw new Error("session not found");
    this.db.prepare("UPDATE projects SET authorization_mode = ?, updated_at = ? WHERE id = ?")
      .run(mode, Date.now(), cur.projectId);
  }

  setBrowserEnabled(id: string, enabled: boolean): void {
    const cur = this.findById(id);
    if (!cur) throw new Error("session not found");
    this.db.prepare("UPDATE sessions SET browser_enabled = ?, updated_at = ? WHERE id = ?")
      .run(enabled ? 1 : 0, Date.now(), id);
  }

  private withPlugins(session: SessionDto): SessionDto {
    const rows = this.db.prepare(
      "SELECT plugin_id FROM session_plugins WHERE session_id = ? ORDER BY selected_at, plugin_id",
    ).all(session.id) as { plugin_id: string }[];
    const selectedPluginIds = rows.map((row) => row.plugin_id);
    return {
      ...session,
      selectedPluginIds,
      browserEnabled: selectedPluginIds.includes("browser-use") || session.browserEnabled,
    };
  }

  markActiveAsCrashed(): void {
    this.db.prepare("UPDATE sessions SET status = 'crashed', updated_at = ? WHERE (status = 'active' OR status = 'idle') AND deleted_at IS NULL").run(Date.now());
  }

  delete(id: string): void {
    const now = Date.now();
    this.db.prepare("UPDATE sessions SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL").run(now, now, id);
  }

  restore(id: string): void {
    const now = Date.now();
    this.db.prepare("UPDATE sessions SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL").run(now, id);
  }

  destroyPermanently(id: string): void {
    this.db.prepare("DELETE FROM messages WHERE session_id = ?").run(id);
    this.db.prepare("DELETE FROM session_kb_bindings WHERE session_id = ?").run(id);
    this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  }

  /** Permanently delete sessions trashed before `cutoff`. */
  purgeDeletedOlderThan(cutoff: number): string[] {
    const rows = this.db.prepare(
      "SELECT id FROM sessions WHERE deleted_at IS NOT NULL AND deleted_at < ?"
    ).all(cutoff) as { id: string }[];
    for (const r of rows) this.destroyPermanently(r.id);
    return rows.map((r) => r.id);
  }

  listDeleted(): SessionDto[] {
    return (this.db.prepare(`
      SELECT sessions.*, projects.authorization_mode AS project_authorization_mode
      FROM sessions
      JOIN projects ON projects.id = sessions.project_id
      WHERE sessions.deleted_at IS NOT NULL
      ORDER BY sessions.deleted_at DESC
    `).all() as Row[])
      .map((row) => this.withPlugins(toDto(row)));
  }
}
