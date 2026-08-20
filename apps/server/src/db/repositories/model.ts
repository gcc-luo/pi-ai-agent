import type Database from "better-sqlite3";
import { ModelDto, ModelType } from "@pi-web-ui/shared";

type ModelRow = {
  id: string;
  label: string;
  provider: string;
  model_type: string;
  api_base_url: string | null;
  api_key: string | null;
  is_default: number;
  created_at: number;
  updated_at: number;
};

function normalizeModelType(v: string | null | undefined): ModelType {
  if (v === "multimodal" || v === "embedding") return v;
  return "text";
}

function toDto(r: ModelRow): ModelDto {
  return {
    id: r.id,
    label: r.label,
    provider: r.provider,
    modelType: normalizeModelType(r.model_type),
    apiBaseUrl: r.api_base_url,
    // API keys are credentials, not display data. Callers that need to use a
    // key must go through getApiKey() inside the server process.
    apiKey: null,
    hasApiKey: r.api_key !== null && r.api_key !== "",
    isDefault: r.is_default === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export class ModelRepository {
  constructor(private db: Database.Database) {}

  create(input: {
    id: string;
    label: string;
    provider: string;
    modelType?: ModelType;
    apiBaseUrl?: string;
    apiKey?: string;
    isDefault?: boolean;
  }): ModelDto {
    const now = Date.now();
    if (input.isDefault) this.clearDefault();
    const modelType = input.modelType ?? "text";
    this.db
      .prepare(
        `INSERT INTO models (id, label, provider, model_type, api_base_url, api_key, is_default, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.label,
        input.provider,
        modelType,
        input.apiBaseUrl ?? null,
        input.apiKey ?? null,
        input.isDefault ? 1 : 0,
        now,
        now,
      );
    return {
      id: input.id,
      label: input.label,
      provider: input.provider,
      modelType,
      apiBaseUrl: input.apiBaseUrl ?? null,
      apiKey: input.apiKey ?? null,
      hasApiKey: !!input.apiKey,
      isDefault: input.isDefault ?? false,
      createdAt: now,
      updatedAt: now,
    };
  }

  findById(id: string): ModelDto | null {
    const r = this.db.prepare("SELECT * FROM models WHERE id = ?").get(id) as ModelRow | undefined;
    return r ? toDto(r) : null;
  }

  list(): ModelDto[] {
    return (this.db.prepare("SELECT * FROM models ORDER BY provider ASC, label ASC").all() as ModelRow[]).map(toDto);
  }

  getApiKey(id: string): string | null {
    const r = this.db.prepare("SELECT api_key FROM models WHERE id = ?").get(id) as
      | { api_key: string | null }
      | undefined;
    return r?.api_key ?? null;
  }

  update(
    id: string,
    patch: Partial<{
      label: string;
      provider: string;
      modelType: ModelType;
      apiBaseUrl: string | null;
      apiKey: string | null;
      isDefault: boolean;
    }>,
  ): void {
    const cur = this.findById(id);
    if (!cur) throw new Error("model not found");
    const now = Date.now();

    if (patch.isDefault) this.clearDefault();

    const label = patch.label ?? cur.label;
    const provider = patch.provider ?? cur.provider;
    const modelType = patch.modelType ?? cur.modelType;
    const apiBaseUrl = patch.apiBaseUrl === undefined ? cur.apiBaseUrl : patch.apiBaseUrl;
    const isDefault = patch.isDefault !== undefined ? (patch.isDefault ? 1 : 0) : cur.isDefault ? 1 : 0;

    let apiKey: string | null;
    if (patch.apiKey === undefined) {
      apiKey = this.getApiKey(id);
    } else {
      apiKey = patch.apiKey;
    }

    this.db
      .prepare(
        `UPDATE models SET label = ?, provider = ?, model_type = ?, api_base_url = ?, api_key = ?, is_default = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(label, provider, modelType, apiBaseUrl, apiKey, isDefault, now, id);
  }

  delete(id: string): void {
    this.db.prepare("DELETE FROM models WHERE id = ?").run(id);
  }

  getDefault(): ModelDto | null {
    const r = this.db.prepare("SELECT * FROM models WHERE is_default = 1").get() as ModelRow | undefined;
    return r ? toDto(r) : null;
  }

  setDefault(id: string): void {
    this.clearDefault();
    this.db.prepare("UPDATE models SET is_default = 1, updated_at = ? WHERE id = ?").run(Date.now(), id);
  }

  private clearDefault(): void {
    this.db.prepare("UPDATE models SET is_default = 0 WHERE is_default = 1").run();
  }
}
