import type Database from "better-sqlite3";
import { SessionDto, SessionStatus } from "@pi-web-ui/shared";
import { ulid } from "../../util/ulid.js";

type Row = {
  id: string; project_id: string; title: string | null; parent_id: string | null;
  status: SessionStatus; pi_session_ref: string | null;
  created_at: number; updated_at: number; last_active_at: number | null;
};

function toDto(r: Row): SessionDto {
  return {
    id: r.id, projectId: r.project_id, title: r.title, parentId: r.parent_id,
    status: r.status, createdAt: r.created_at, updatedAt: r.updated_at, lastActiveAt: r.last_active_at,
  };
}

export class SessionRepository {
  constructor(private db: Database.Database) {}

  create(input: { projectId: string; parentId?: string; title?: string }): SessionDto {
    const id = ulid();
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO sessions (id, project_id, title, parent_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'active', ?, ?)
    `).run(id, input.projectId, input.title ?? null, input.parentId ?? null, now, now);
    return {
      id, projectId: input.projectId, title: input.title ?? null, parentId: input.parentId ?? null,
      status: "active", createdAt: now, updatedAt: now, lastActiveAt: null,
    };
  }

  findById(id: string): SessionDto | null {
    const r = this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as Row | undefined;
    return r ? toDto(r) : null;
  }

  listByProject(projectId: string): SessionDto[] {
    return (this.db.prepare("SELECT * FROM sessions WHERE project_id = ? ORDER BY updated_at DESC").all(projectId) as Row[]).map(toDto);
  }

  children(parentId: string): SessionDto[] {
    return (this.db.prepare("SELECT * FROM sessions WHERE parent_id = ?").all(parentId) as Row[]).map(toDto);
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

  markActiveAsCrashed(): void {
    this.db.prepare("UPDATE sessions SET status = 'crashed', updated_at = ? WHERE status = 'active' OR status = 'idle'").run(Date.now());
  }

  delete(id: string): void {
    this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  }
}
