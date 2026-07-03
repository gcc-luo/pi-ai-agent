import type Database from "better-sqlite3";
import { ProjectDto } from "@pi-web-ui/shared";
import { ulid } from "../../util/ulid.js";

type ProjectRow = {
  id: string; name: string; workdir: string; description: string | null;
  created_at: number; updated_at: number;
};

function toDto(r: ProjectRow): ProjectDto {
  return {
    id: r.id, name: r.name, workdir: r.workdir, description: r.description,
    createdAt: r.created_at, updatedAt: r.updated_at,
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
    return { id, name: input.name, workdir: input.workdir, description: input.description ?? null, createdAt: now, updatedAt: now };
  }

  findById(id: string): ProjectDto | null {
    const r = this.db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
    return r ? toDto(r) : null;
  }

  list(): ProjectDto[] {
    return (this.db.prepare("SELECT * FROM projects ORDER BY updated_at DESC").all() as ProjectRow[]).map(toDto);
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
    this.db.prepare("DELETE FROM projects WHERE id = ?").run(id);
  }
}
