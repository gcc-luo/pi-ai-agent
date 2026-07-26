import type Database from "better-sqlite3";
import type { ChannelConfigDto, ChannelType } from "@pi-web-ui/shared";
import { ulid } from "../../util/ulid.js";

type ChannelRow = {
  id: string;
  type: ChannelType;
  name: string;
  enabled: number;
  config: string;
  created_at: number;
  updated_at: number;
};

function toDto(r: ChannelRow): ChannelConfigDto {
  return {
    id: r.id,
    type: r.type,
    name: r.name,
    enabled: r.enabled === 1,
    config: JSON.parse(r.config) as Record<string, unknown>,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export class ChannelRepository {
  constructor(private db: Database.Database) {}

  list(): ChannelConfigDto[] {
    return (this.db.prepare(
      "SELECT * FROM channels ORDER BY created_at ASC",
    ).all() as ChannelRow[]).map(toDto);
  }

  findById(id: string): ChannelConfigDto | null {
    const r = this.db.prepare("SELECT * FROM channels WHERE id = ?").get(id) as ChannelRow | undefined;
    return r ? toDto(r) : null;
  }

  create(input: {
    type: ChannelType;
    name: string;
    enabled?: boolean;
    config: Record<string, unknown>;
  }): ChannelConfigDto {
    const id = ulid();
    const now = Date.now();
    const enabled = input.enabled === false ? 0 : 1;
    const config = JSON.stringify(input.config);

    this.db.prepare(`
      INSERT INTO channels (id, type, name, enabled, config, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.type, input.name, enabled, config, now, now);

    return {
      id,
      type: input.type,
      name: input.name,
      enabled: input.enabled !== false,
      config: input.config,
      createdAt: now,
      updatedAt: now,
    };
  }

  update(id: string, patch: {
    name?: string;
    enabled?: boolean;
    config?: Record<string, unknown>;
  }): ChannelConfigDto | null {
    const cur = this.findById(id);
    if (!cur) return null;

    const name = patch.name ?? cur.name;
    const enabled = patch.enabled !== undefined ? patch.enabled : cur.enabled;
    const config = patch.config ?? cur.config;
    const now = Date.now();

    this.db.prepare(`
      UPDATE channels SET name = ?, enabled = ?, config = ?, updated_at = ? WHERE id = ?
    `).run(name, enabled ? 1 : 0, JSON.stringify(config), now, id);

    return {
      ...cur,
      name,
      enabled,
      config,
      updatedAt: now,
    };
  }

  delete(id: string): boolean {
    const result = this.db.prepare("DELETE FROM channels WHERE id = ?").run(id);
    return result.changes > 0;
  }
}
