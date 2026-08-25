import crypto from "node:crypto";
import type Database from "better-sqlite3";
import type {
  ConnectorAuditDto, ConnectorToolDto, ConnectorToolPolicy, CreateConnectorInput,
} from "@pi-web-ui/shared";
import { ulid } from "../util/ulid.js";
import type { InvocationAuditInput, StoredConnector } from "./types.js";

type Row = Record<string, any>;
const parse = (value: string | null | undefined, fallback: unknown = null) => {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
};

export function defaultRisk(name: string): ConnectorToolDto["riskLevel"] {
  const lower = name.toLowerCase();
  if (/delete|remove|drop|execute|publish|transfer|payment|destroy|revoke/.test(lower)) return "high";
  if (/create|update|write|upload|send|edit|move|rename/.test(lower)) return "medium";
  if (/get|list|search|read|query|fetch|find|describe/.test(lower)) return "low";
  return "unknown";
}

export function defaultPolicy(risk: ConnectorToolDto["riskLevel"]): ConnectorToolPolicy {
  return risk === "low" ? "allow" : "ask";
}

export class ConnectorRepository {
  constructor(private readonly db: Database.Database) {}

  list(workspaceId?: string): StoredConnector[] {
    const rows = workspaceId
      ? this.db.prepare("SELECT * FROM connector_instances WHERE scope_type = 'user' OR (scope_type = 'workspace' AND scope_id = ?) ORDER BY updated_at DESC").all(workspaceId)
      : this.db.prepare("SELECT * FROM connector_instances ORDER BY updated_at DESC").all();
    return (rows as Row[]).map(this.mapConnector);
  }

  find(id: string): StoredConnector | null {
    const row = this.db.prepare("SELECT * FROM connector_instances WHERE id = ?").get(id) as Row | undefined;
    return row ? this.mapConnector(row) : null;
  }

  create(input: CreateConnectorInput, builtinKey: string | null = null): StoredConnector {
    const id = `conn_${ulid()}`;
    const now = Date.now();
    this.db.prepare(`INSERT INTO connector_instances
      (id,name,description,icon,protocol,scope_type,scope_id,enabled,lifecycle,config_json,created_at,updated_at,builtin_key)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, input.name, input.description ?? null, input.icon ?? "🔌", "mcp",
      input.scopeType, input.scopeId ?? null, 1, input.lifecycle ?? "lazy",
      JSON.stringify(input.config), now, now, builtinKey,
    );
    return this.find(id)!;
  }

  update(id: string, patch: Partial<CreateConnectorInput> & { enabled?: boolean }): StoredConnector | null {
    const current = this.find(id);
    if (!current) return null;
    this.db.prepare(`UPDATE connector_instances SET name=?, description=?, icon=?, scope_type=?, scope_id=?,
      enabled=?, lifecycle=?, config_json=?, updated_at=? WHERE id=?`).run(
      patch.name ?? current.name, patch.description ?? current.description, patch.icon ?? current.icon,
      patch.scopeType ?? current.scopeType, patch.scopeId !== undefined ? patch.scopeId : current.scopeId,
      patch.enabled === undefined ? Number(current.enabled) : Number(patch.enabled),
      patch.lifecycle ?? current.lifecycle, JSON.stringify(patch.config ?? current.config), Date.now(), id,
    );
    return this.find(id);
  }

  remove(id: string): string[] {
    const credentials = (this.db.prepare("SELECT credential_id FROM connector_credential_bindings WHERE connector_id = ?").all(id) as { credential_id: string }[]).map((r) => r.credential_id);
    this.db.prepare("DELETE FROM connector_instances WHERE id = ?").run(id);
    return credentials;
  }

  bindCredential(connectorId: string, fieldPath: string, credentialId: string): string | null {
    const previous = this.db.prepare("SELECT credential_id FROM connector_credential_bindings WHERE connector_id=? AND field_path=?").get(connectorId, fieldPath) as { credential_id: string } | undefined;
    this.db.prepare(`INSERT INTO connector_credential_bindings (id,connector_id,field_path,credential_id,created_at)
      VALUES (?,?,?,?,?) ON CONFLICT(connector_id,field_path) DO UPDATE SET credential_id=excluded.credential_id`).run(
      `bind_${ulid()}`, connectorId, fieldPath, credentialId, Date.now(),
    );
    return previous?.credential_id ?? null;
  }

  credentialIds(id: string): string[] {
    return (this.db.prepare("SELECT credential_id FROM connector_credential_bindings WHERE connector_id=?").all(id) as { credential_id: string }[]).map((r) => r.credential_id);
  }

  setRuntimeState(id: string, input: { connected?: boolean; errorCode?: string | null; error?: string | null }): void {
    this.db.prepare(`UPDATE connector_instances SET last_connected_at=COALESCE(?,last_connected_at),
      last_error_code=?,last_error=? WHERE id=?`).run(input.connected ? Date.now() : null, input.errorCode ?? null, input.error ?? null, id);
  }

  upsertTools(connectorId: string, tools: Array<{ name: string; title?: string; description?: string; inputSchema?: unknown; outputSchema?: unknown }>): ConnectorToolDto[] {
    const now = Date.now();
    const statement = this.db.prepare(`INSERT INTO connector_tools
      (id,connector_id,tool_name,title,description,input_schema_json,output_schema_json,schema_hash,enabled,direct_tool,risk_level,discovered_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,1,0,?,?,?) ON CONFLICT(connector_id,tool_name) DO UPDATE SET
      title=excluded.title,description=excluded.description,input_schema_json=excluded.input_schema_json,
      output_schema_json=excluded.output_schema_json,schema_hash=excluded.schema_hash,updated_at=excluded.updated_at`);
    const policy = this.db.prepare(`INSERT OR IGNORE INTO connector_tool_policies
      (id,connector_id,tool_name,scope_type,scope_id,policy,created_at,updated_at) VALUES (?,?,?,'connector','',?,?,?)`);
    const tx = this.db.transaction(() => {
      for (const tool of tools) {
        const risk = defaultRisk(tool.name);
        const schema = JSON.stringify(tool.inputSchema ?? {});
        statement.run(`tool_${ulid()}`, connectorId, tool.name, tool.title ?? null, tool.description ?? null,
          schema, tool.outputSchema === undefined ? null : JSON.stringify(tool.outputSchema),
          crypto.createHash("sha256").update(schema).digest("hex"), risk, now, now);
        policy.run(`policy_${ulid()}`, connectorId, tool.name, defaultPolicy(risk), now, now);
      }
    });
    tx();
    return this.listTools(connectorId);
  }

  listTools(connectorId: string): ConnectorToolDto[] {
    const rows = this.db.prepare(`SELECT t.*, COALESCE(p.policy, 'ask') policy FROM connector_tools t
      LEFT JOIN connector_tool_policies p ON p.connector_id=t.connector_id AND p.tool_name=t.tool_name
      AND p.scope_type='connector' AND p.scope_id='' WHERE t.connector_id=? ORDER BY t.tool_name`).all(connectorId) as Row[];
    return rows.map((row) => ({
      connectorId: row.connector_id, name: row.tool_name, title: row.title, description: row.description,
      inputSchema: parse(row.input_schema_json, {}), outputSchema: parse(row.output_schema_json),
      enabled: Boolean(row.enabled), policy: row.policy, riskLevel: row.risk_level,
      directTool: Boolean(row.direct_tool), updatedAt: row.updated_at,
    }));
  }

  findTool(connectorId: string, name: string): ConnectorToolDto | null {
    return this.listTools(connectorId).find((tool) => tool.name === name) ?? null;
  }

  setTool(connectorId: string, name: string, patch: { enabled?: boolean; policy?: ConnectorToolPolicy }): ConnectorToolDto | null {
    if (patch.enabled !== undefined) this.db.prepare("UPDATE connector_tools SET enabled=?,updated_at=? WHERE connector_id=? AND tool_name=?").run(Number(patch.enabled), Date.now(), connectorId, name);
    if (patch.policy) this.db.prepare(`INSERT INTO connector_tool_policies
      (id,connector_id,tool_name,scope_type,scope_id,policy,created_at,updated_at) VALUES (?,?,?,'connector','',?,?,?)
      ON CONFLICT(connector_id,tool_name,scope_type,scope_id) DO UPDATE SET policy=excluded.policy,updated_at=excluded.updated_at`).run(
      `policy_${ulid()}`, connectorId, name, patch.policy, Date.now(), Date.now(),
    );
    return this.findTool(connectorId, name);
  }

  appendAudit(input: InvocationAuditInput): void {
    this.db.prepare(`INSERT INTO connector_audits
      (id,session_id,workspace_id,connector_id,tool_name,source,policy,approval,status,duration_ms,error_code,argument_keys_json,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(`audit_${ulid()}`, input.context.sessionId, input.context.workspaceId,
      input.connectorId, input.toolName, input.context.source, input.policy, input.approval, input.status,
      input.durationMs, input.errorCode ?? null, JSON.stringify(input.argumentKeys), Date.now());
  }

  listAudits(connectorId: string, limit = 100): ConnectorAuditDto[] {
    return (this.db.prepare("SELECT * FROM connector_audits WHERE connector_id=? ORDER BY created_at DESC LIMIT ?").all(connectorId, limit) as Row[]).map((row) => ({
      id: row.id, sessionId: row.session_id, workspaceId: row.workspace_id, connectorId: row.connector_id,
      toolName: row.tool_name, source: row.source, policy: row.policy, approval: row.approval,
      status: row.status, durationMs: row.duration_ms, errorCode: row.error_code,
      argumentKeys: parse(row.argument_keys_json, []), createdAt: row.created_at,
    }));
  }

  private mapConnector(row: Row): StoredConnector {
    return { id: row.id, name: row.name, description: row.description, icon: row.icon, protocol: "mcp", builtinKey: row.builtin_key ?? null,
      scopeType: row.scope_type, scopeId: row.scope_id, enabled: Boolean(row.enabled), lifecycle: row.lifecycle,
      config: parse(row.config_json, {}), lastConnectedAt: row.last_connected_at,
      lastErrorCode: row.last_error_code, lastError: row.last_error, createdAt: row.created_at, updatedAt: row.updated_at };
  }
}
