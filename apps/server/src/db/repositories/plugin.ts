import type Database from "better-sqlite3";
import type { PluginAuditDto } from "@pi-web-ui/shared";
import { ulid } from "../../util/ulid.js";

interface SettingRow {
  plugin_id: string;
  enabled: number;
  settings: string;
  last_error: string | null;
  updated_at: number;
}

export interface PluginSetting {
  pluginId: string;
  enabled: boolean;
  settings: Record<string, unknown>;
  lastError: string | null;
  updatedAt: number;
}

function parseObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export class PluginRepository {
  constructor(private readonly db: Database.Database) {}

  ensure(pluginId: string, enabled: boolean, settings: Record<string, unknown> = {}): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO plugin_settings
        (plugin_id, enabled, settings, last_error, updated_at)
      VALUES (?, ?, ?, NULL, ?)
    `).run(pluginId, enabled ? 1 : 0, JSON.stringify(settings), Date.now());
  }

  find(pluginId: string): PluginSetting | null {
    const row = this.db.prepare(
      "SELECT * FROM plugin_settings WHERE plugin_id = ?",
    ).get(pluginId) as SettingRow | undefined;
    return row ? this.toSetting(row) : null;
  }

  list(): PluginSetting[] {
    return (this.db.prepare("SELECT * FROM plugin_settings").all() as SettingRow[])
      .map((row) => this.toSetting(row));
  }

  update(
    pluginId: string,
    patch: { enabled?: boolean; settings?: Record<string, unknown>; lastError?: string | null },
  ): PluginSetting {
    const current = this.find(pluginId);
    if (!current) throw new Error("plugin not found");
    const enabled = patch.enabled ?? current.enabled;
    const settings = patch.settings ?? current.settings;
    const lastError = patch.lastError === undefined ? current.lastError : patch.lastError;
    this.db.prepare(`
      UPDATE plugin_settings
      SET enabled = ?, settings = ?, last_error = ?, updated_at = ?
      WHERE plugin_id = ?
    `).run(enabled ? 1 : 0, JSON.stringify(settings), lastError, Date.now(), pluginId);
    return this.find(pluginId)!;
  }

  selectedForSession(sessionId: string): string[] {
    return (this.db.prepare(`
      SELECT plugin_id FROM session_plugins
      WHERE session_id = ?
      ORDER BY selected_at, plugin_id
    `).all(sessionId) as { plugin_id: string }[]).map((row) => row.plugin_id);
  }

  setSelectedForSession(sessionId: string, pluginIds: string[]): void {
    const remove = this.db.prepare("DELETE FROM session_plugins WHERE session_id = ?");
    const insert = this.db.prepare(`
      INSERT INTO session_plugins (session_id, plugin_id, selected_at)
      VALUES (?, ?, ?)
    `);
    this.db.transaction(() => {
      remove.run(sessionId);
      const now = Date.now();
      for (const pluginId of pluginIds) insert.run(sessionId, pluginId, now);
      this.db.prepare(
        "UPDATE sessions SET browser_enabled = ?, updated_at = ? WHERE id = ?",
      ).run(pluginIds.includes("browser-use") ? 1 : 0, now, sessionId);
    })();
  }

  sessionsSelecting(pluginId: string): string[] {
    return (this.db.prepare(
      "SELECT session_id FROM session_plugins WHERE plugin_id = ?",
    ).all(pluginId) as { session_id: string }[]).map((row) => row.session_id);
  }

  appendAudit(input: {
    pluginId: string;
    sessionId?: string | null;
    action: string;
    risk: PluginAuditDto["risk"];
    approved: boolean;
    success: boolean;
    details?: Record<string, unknown>;
  }): void {
    this.db.prepare(`
      INSERT INTO plugin_audit_logs
        (id, plugin_id, session_id, action, risk, approved, success, details, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      ulid(),
      input.pluginId,
      input.sessionId ?? null,
      input.action,
      input.risk,
      input.approved ? 1 : 0,
      input.success ? 1 : 0,
      JSON.stringify(input.details ?? {}),
      Date.now(),
    );
  }

  private toSetting(row: SettingRow): PluginSetting {
    return {
      pluginId: row.plugin_id,
      enabled: row.enabled === 1,
      settings: parseObject(row.settings),
      lastError: row.last_error,
      updatedAt: row.updated_at,
    };
  }
}
