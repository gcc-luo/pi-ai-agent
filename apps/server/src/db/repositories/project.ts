import type Database from "better-sqlite3";
import { ProjectDto } from "@pi-web-ui/shared";
import { ulid } from "../../util/ulid.js";

type ProjectRow = {
  id: string; name: string; workdir: string; description: string | null;
  deleted_at: number | null;
  created_at: number; updated_at: number;
};

function toDto(r: ProjectRow): ProjectDto {
  return {
    id: r.id, name: r.name, workdir: r.workdir, description: r.description,
    createdAt: r.created_at, updatedAt: r.updated_at, deletedAt: r.deleted_at,
  };
}

export class ProjectRepository {
  constructor(private db: Database.Database) {}

  create(input: { id?: string; name: string; workdir: string; description?: string }): ProjectDto {
    const id = input.id ?? ulid();
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO projects (id, name, workdir, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, input.name, input.workdir, input.description ?? null, now, now);
    return { id, name: input.name, workdir: input.workdir, description: input.description ?? null, createdAt: now, updatedAt: now, deletedAt: null };
  }

  findById(id: string): ProjectDto | null {
    const r = this.db.prepare("SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL").get(id) as ProjectRow | undefined;
    return r ? toDto(r) : null;
  }

  list(): ProjectDto[] {
    return (this.db.prepare("SELECT * FROM projects WHERE deleted_at IS NULL ORDER BY updated_at DESC").all() as ProjectRow[]).map(toDto);
  }

  update(id: string, patch: Partial<{ name: string; description: string | null }>): void {
    const cur = this.findById(id);
    if (!cur) throw new Error("project not found");
    const name = patch.name ?? cur.name;
    const description = patch.description === undefined ? cur.description : patch.description;
    this.db.prepare("UPDATE projects SET name = ?, description = ?, updated_at = ? WHERE id = ?")
      .run(name, description, Date.now(), id);
  }

  delete(id: string): void {
    this.db.prepare("UPDATE projects SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL")
      .run(Date.now(), Date.now(), id);
  }

  restore(id: string): void {
    const now = Date.now();
    this.db.prepare("UPDATE projects SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL").run(now, id);
  }

  destroyPermanently(id: string): void {
    // Cascade: sessions → messages, session_kb_bindings
    const sessionIds = (this.db.prepare(
      "SELECT id FROM sessions WHERE project_id = ?"
    ).all(id) as { id: string }[]).map(r => r.id);

    const deleteMessages = this.db.prepare("DELETE FROM messages WHERE session_id = ?");
    const deleteBindings = this.db.prepare("DELETE FROM session_kb_bindings WHERE session_id = ?");
    for (const sid of sessionIds) {
      deleteMessages.run(sid);
      deleteBindings.run(sid);
    }
    this.db.prepare("DELETE FROM sessions WHERE project_id = ?").run(id);
    this.db.prepare("DELETE FROM projects WHERE id = ?").run(id);
  }

  listDeleted(): ProjectDto[] {
    return (this.db.prepare(
      "SELECT * FROM projects WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC"
    ).all() as ProjectRow[]).map(toDto);
  }
}
