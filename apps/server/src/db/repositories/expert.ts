import type Database from "better-sqlite3";
import { ExpertDto, ExpertCategory } from "@pi-web-ui/shared";
import { ulid } from "../../util/ulid.js";

type ExpertRow = {
  id: string; name: string; icon: string; category: ExpertCategory;
  description: string; system_prompt: string; tags: string;
  is_preset: number; sort_order: number;
  created_at: number; updated_at: number;
};

function toDto(r: ExpertRow): ExpertDto {
  return {
    id: r.id, name: r.name, icon: r.icon, category: r.category,
    description: r.description, systemPrompt: r.system_prompt,
    tags: JSON.parse(r.tags), isPreset: r.is_preset === 1,
    sortOrder: r.sort_order, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export class ExpertRepository {
  constructor(private db: Database.Database) {}

  list(category?: ExpertCategory): ExpertDto[] {
    if (category) {
      return (this.db.prepare(
        "SELECT * FROM experts WHERE category = ? ORDER BY sort_order DESC, created_at DESC"
      ).all(category) as ExpertRow[]).map(toDto);
    }
    return (this.db.prepare(
      "SELECT * FROM experts ORDER BY sort_order DESC, created_at DESC"
    ).all() as ExpertRow[]).map(toDto);
  }

  findById(id: string): ExpertDto | null {
    const r = this.db.prepare("SELECT * FROM experts WHERE id = ?").get(id) as ExpertRow | undefined;
    return r ? toDto(r) : null;
  }

  create(input: {
    name: string; icon?: string; category: ExpertCategory;
    description: string; systemPrompt: string; tags?: string[];
    isPreset?: boolean; sortOrder?: number;
  }): ExpertDto {
    const id = ulid();
    const now = Date.now();
    const icon = input.icon ?? "🤖";
    const tags = JSON.stringify(input.tags ?? []);
    const isPreset = input.isPreset ? 1 : 0;
    const sortOrder = input.sortOrder ?? 0;

    this.db.prepare(`
      INSERT INTO experts (id, name, icon, category, description, system_prompt, tags, is_preset, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.name, icon, input.category, input.description, input.systemPrompt, tags, isPreset, sortOrder, now, now);

    return {
      id, name: input.name, icon, category: input.category,
      description: input.description, systemPrompt: input.systemPrompt,
      tags: input.tags ?? [], isPreset: !!input.isPreset, sortOrder,
      createdAt: now, updatedAt: now,
    };
  }

  update(id: string, patch: Partial<{
    name: string; icon: string; category: ExpertCategory;
    description: string; systemPrompt: string; tags: string[]; sortOrder: number;
  }>): ExpertDto | null {
    const cur = this.findById(id);
    if (!cur) return null;

    const name = patch.name ?? cur.name;
    const icon = patch.icon ?? cur.icon;
    const category = patch.category ?? cur.category;
    const description = patch.description ?? cur.description;
    const systemPrompt = patch.systemPrompt ?? cur.systemPrompt;
    const tags = patch.tags ? JSON.stringify(patch.tags) : JSON.stringify(cur.tags);
    const sortOrder = patch.sortOrder ?? cur.sortOrder;
    const now = Date.now();

    this.db.prepare(`
      UPDATE experts SET name = ?, icon = ?, category = ?, description = ?, system_prompt = ?, tags = ?, sort_order = ?, updated_at = ?
      WHERE id = ?
    `).run(name, icon, category, description, systemPrompt, tags, sortOrder, now, id);

    return {
      ...cur, name, icon, category, description, systemPrompt,
      tags: patch.tags ?? cur.tags, sortOrder, updatedAt: now,
    };
  }

  delete(id: string): boolean {
    const result = this.db.prepare("DELETE FROM experts WHERE id = ? AND is_preset = 0").run(id);
    return result.changes > 0;
  }

  countPresets(): number {
    return (this.db.prepare("SELECT COUNT(*) as cnt FROM experts WHERE is_preset = 1").get() as { cnt: number }).cnt;
  }

  seedPresets(presets: Array<Omit<Parameters<typeof this.create>[0], "isPreset">>): void {
    // Seed by name rather than only on an empty table. This lets a product
    // update add newly bundled experts for existing installations while
    // leaving all previously created presets and custom experts untouched.
    const existingNames = new Set(
      (this.db.prepare("SELECT name FROM experts WHERE is_preset = 1").all() as { name: string }[])
        .map((expert) => expert.name),
    );
    const missing = presets.filter((preset) => !existingNames.has(preset.name));
    if (!missing.length) return;

    console.log(`[ExpertRepository] seeding ${missing.length} new preset experts...`);
    const tx = this.db.transaction(() => {
      for (const p of missing) {
        this.create({ ...p, isPreset: true });
      }
    });
    tx();
    console.log(`[ExpertRepository] preset seeding complete, count now: ${this.countPresets()}`);
  }
}
