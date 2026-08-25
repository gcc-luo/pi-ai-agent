import fs from "node:fs";
import path from "node:path";
import type {
  ConnectorDto, ConnectorTestResult, ConnectorToolPolicy, CreateConnectorInput, McpConnectorConfig,
  BuiltinConnectorDto,
} from "@pi-web-ui/shared";
import type { ConnectorRepository } from "./connector-repository.js";
import type { CredentialVault } from "./credential-vault.js";
import type { McpRuntimeManager } from "./mcp-runtime.js";
import { ConnectorError, type ConnectorInvocationContext } from "./types.js";
import { BUILTIN_CONNECTORS, builtinManifest } from "./builtins.js";

const SECRET_KEY = /token|secret|password|authorization|cookie|api[_-]?key|access[_-]?key/i;

const TENCENT_DOCS_GUIDANCE = [
  "腾讯文档定位规则：链接 /sheet/<id> 是普通在线表格，只能使用 sheet.* 工具；",
  "/smartsheet/<id> 才使用 smartsheet.* 工具；file_id 必须是路径中完整的 <id>，",
  "不要删除开头字符（例如 /sheet/DUHZ... 的 file_id 是 DUHZ...）。",
  "只有文档标题而没有链接或 file_id 时，先调用 manage.search_file 查找文档。",
].join("");

function queryTerms(query: string): string[] {
  const normalized = query.toLowerCase()
    .replace(/腾讯云文档/g, "腾讯文档")
    .replace(/spreadsheets?/g, "sheet")
    .replace(/xlsx|excel/g, "sheet");
  return [...new Set(normalized.split(/[\s,，。;；:：/\\|]+/).filter((term) => term.length > 1))];
}

export class ConnectorService {
  constructor(
    private readonly repository: ConnectorRepository,
    private readonly vault: CredentialVault,
    private readonly runtime: McpRuntimeManager,
  ) {}

  list(workspaceId?: string): ConnectorDto[] {
    return this.repository.list(workspaceId).map((connector) => this.toDto(connector));
  }

  get(id: string): ConnectorDto | null {
    const connector = this.repository.find(id);
    return connector ? this.toDto(connector) : null;
  }

  catalog(): BuiltinConnectorDto[] {
    const instances = this.repository.list();
    return BUILTIN_CONNECTORS.map(({ createInput: _createInput, tokenFieldPath: _tokenFieldPath, ...manifest }) => {
      const instance = instances.find((item) => item.builtinKey === manifest.key);
      return { ...manifest, connected: Boolean(instance), instanceId: instance?.id ?? null };
    });
  }

  connectBuiltin(key: string, token: string): ConnectorDto {
    const manifest = builtinManifest(key);
    if (!manifest) throw new ConnectorError("CONFIG_INVALID", "未知的内置连接器。");
    if (!token?.trim()) throw new ConnectorError("CONFIG_INVALID", "请输入授权 Token。");
    if (this.repository.list().some((item) => item.builtinKey === key)) {
      throw new ConnectorError("CONFIG_INVALID", "该连接器已经连接。");
    }
    const input = manifest.createInput(token.trim());
    this.validate(input);
    const publicInput: CreateConnectorInput = { ...input, credentials: undefined, config: structuredClone(input.config) };
    const credentialId = this.vault.save(token.trim());
    this.assignCredentialRef(publicInput.config, manifest.tokenFieldPath, credentialId);
    const connector = this.repository.create(publicInput, key);
    this.repository.bindCredential(connector.id, manifest.tokenFieldPath, credentialId);
    return this.toDto(connector);
  }

  create(input: CreateConnectorInput): ConnectorDto {
    this.validate(input);
    const credentials = input.credentials ?? {};
    const publicInput: CreateConnectorInput = { ...input, credentials: undefined, config: structuredClone(input.config) };
    for (const [fieldPath, value] of Object.entries(credentials)) {
      if (!value) continue;
      const credentialId = this.vault.save(value);
      this.assignCredentialRef(publicInput.config, fieldPath, credentialId);
    }
    const connector = this.repository.create(publicInput);
    for (const [fieldPath, ref] of this.credentialRefs(connector.config)) this.repository.bindCredential(connector.id, fieldPath, ref.credentialId);
    return this.toDto(connector);
  }

  async update(id: string, input: Partial<CreateConnectorInput> & { enabled?: boolean }): Promise<ConnectorDto | null> {
    const current = this.repository.find(id);
    if (!current) return null;
    if (input.config) this.validate({ ...current, ...input, config: input.config } as CreateConnectorInput);
    const config = structuredClone(input.config ?? current.config);
    for (const [fieldPath, value] of Object.entries(input.credentials ?? {})) {
      if (!value) continue;
      const credentialId = this.vault.save(value);
      this.assignCredentialRef(config, fieldPath, credentialId);
      const previousId = this.repository.bindCredential(id, fieldPath, credentialId);
      if (previousId && previousId !== credentialId) this.vault.remove(previousId);
    }
    await this.runtime.disconnect(id);
    const updated = this.repository.update(id, { ...input, credentials: undefined, config });
    return updated ? this.toDto(updated) : null;
  }

  async remove(id: string): Promise<boolean> {
    if (!this.repository.find(id)) return false;
    await this.runtime.disconnect(id);
    for (const credentialId of this.repository.remove(id)) this.vault.remove(credentialId);
    return true;
  }

  async test(id: string): Promise<ConnectorTestResult> {
    const connector = this.repository.find(id);
    if (!connector) return { ok: false, toolCount: 0, tools: [], errorCode: "CONFIG_INVALID", error: "连接器不存在" };
    try {
      const tools = await this.runtime.discover(id, connector.config);
      const stored = this.repository.upsertTools(id, tools);
      this.repository.setRuntimeState(id, { connected: true, errorCode: null, error: null });
      return { ok: true, toolCount: stored.length, tools: stored };
    } catch (error) {
      const mapped = error instanceof ConnectorError ? error : new ConnectorError("CONNECTION_FAILED", "连接失败", String(error));
      this.repository.setRuntimeState(id, { errorCode: mapped.code, error: mapped.message });
      return { ok: false, toolCount: 0, tools: [], errorCode: mapped.code, error: mapped.message, technicalDetail: mapped.detail };
    }
  }

  async reconnect(id: string): Promise<void> {
    const connector = this.require(id);
    await this.runtime.reconnect(id, connector.config);
    this.repository.setRuntimeState(id, { connected: true });
  }

  listTools(id: string) { return this.repository.listTools(id); }
  setTool(id: string, name: string, patch: { enabled?: boolean; policy?: ConnectorToolPolicy }) { return this.repository.setTool(id, name, patch); }
  listAudits(id: string) { return this.repository.listAudits(id); }

  searchTools(query: string, workspaceId: string, limit = 10) {
    const terms = queryTerms(query);
    const normalizedQuery = query.toLowerCase().replace(/腾讯云文档/g, "腾讯文档");
    return this.repository.list(workspaceId).filter((connector) => connector.enabled).flatMap((connector) =>
      this.repository.listTools(connector.id).filter((tool) => tool.enabled).map((tool) => {
        const name = tool.name.toLowerCase();
        const connectorName = connector.name.toLowerCase();
        const description = (tool.description ?? "").toLowerCase();
        let score = terms.length === 0 ? 1 : 0;
        for (const term of terms) {
          if (name.includes(term)) score += 8;
          if (description.includes(term)) score += 4;
          if (connectorName.includes(term)) score += 2;
        }
        const hasDocumentTypeHint = /(?:^|\W)sheet(?:\W|$)|在线表格|智能表格|smartsheet/.test(normalizedQuery);
        if (connector.builtinKey === "tencent-docs" && normalizedQuery.includes("文档")
          && !hasDocumentTypeHint && tool.name === "manage.search_file") score += 12;
        return { connector, tool, score };
      }).filter(({ score }) => score > 0),
    ).sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name)).slice(0, Math.max(1, Math.min(limit, 50)))
      .map(({ connector, tool }) => ({
        tool: `${connector.id}.${tool.name}`, connectorId: connector.id, connectorName: connector.name,
        name: tool.name, description: tool.description, policy: tool.policy, riskLevel: tool.riskLevel,
        ...(connector.builtinKey === "tencent-docs" ? { usageGuidance: TENCENT_DOCS_GUIDANCE } : {}),
      }));
  }

  describeTool(compoundName: string, workspaceId: string) {
    const { connector, tool } = this.resolveCompound(compoundName, workspaceId);
    return {
      tool: `${connector.id}.${tool.name}`, connectorName: connector.name, ...tool,
      ...(connector.builtinKey === "tencent-docs" ? { usageGuidance: TENCENT_DOCS_GUIDANCE } : {}),
    };
  }

  async invoke(compoundName: string, args: Record<string, unknown>, context: ConnectorInvocationContext, approve: () => Promise<boolean>) {
    const started = Date.now();
    const { connector, tool } = this.resolveCompound(compoundName, context.workspaceId);
    if (!connector.enabled) throw new ConnectorError("POLICY_DENIED", "连接器已禁用。");
    if (!tool.enabled) throw new ConnectorError("TOOL_DISABLED", "该能力已禁用。");
    let approval = "not_required";
    try {
      if (tool.policy === "deny") throw new ConnectorError("POLICY_DENIED", "权限策略禁止调用该能力。");
      if (tool.policy === "ask") {
        approval = await approve() ? "approved_once" : "rejected";
        if (approval === "rejected") throw new ConnectorError("USER_REJECTED", "用户拒绝了该操作。");
      }
      let result;
      try {
        result = await this.runtime.call(connector.id, connector.config, tool.name, args);
      } catch (error) {
        // Only read-like tools are safe to replay. Write/unknown tools may have
        // completed remotely before the connection failed, so never retry them.
        const retryable = tool.riskLevel === "low" && error instanceof ConnectorError
          && (error.code === "CONNECTION_FAILED" || error.code === "SERVER_DISCONNECTED");
        if (!retryable) throw error;
        await this.runtime.reconnect(connector.id, connector.config);
        result = await this.runtime.call(connector.id, connector.config, tool.name, args);
      }
      const guarded = this.guardResult(result, context, connector.id, tool.name);
      this.repository.appendAudit({ context, connectorId: connector.id, toolName: tool.name, policy: tool.policy, approval, status: "success", durationMs: Date.now() - started, argumentKeys: Object.keys(args) });
      return guarded;
    } catch (error) {
      const mapped = error instanceof ConnectorError ? error : new ConnectorError("INTERNAL_ERROR", "连接器调用失败。", String(error));
      this.repository.appendAudit({ context, connectorId: connector.id, toolName: tool.name, policy: tool.policy, approval, status: "error", durationMs: Date.now() - started, errorCode: mapped.code, argumentKeys: Object.keys(args) });
      throw mapped;
    }
  }

  private guardResult(result: unknown, context: ConnectorInvocationContext, connectorId: string, toolName: string): unknown {
    const serialized = JSON.stringify(result);
    if (Buffer.byteLength(serialized) <= 64 * 1024) return result;
    const directory = path.join(context.cwd, ".pimono", "mcp-results");
    fs.mkdirSync(directory, { recursive: true });
    const filename = `${Date.now()}-${connectorId}-${toolName.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`;
    fs.writeFileSync(path.join(directory, filename), serialized, "utf8");
    return { isError: false, content: [{ type: "text", text: `结果过大，已保存到 .pimono/mcp-results/${filename}` }] };
  }

  private resolveCompound(compoundName: string, workspaceId: string) {
    const connector = this.repository.list(workspaceId).filter((item) => compoundName.startsWith(`${item.id}.`)).sort((a, b) => b.id.length - a.id.length)[0];
    if (!connector) throw new ConnectorError("TOOL_NOT_FOUND", "未找到连接器或当前工作空间无权访问。");
    const tool = this.repository.findTool(connector.id, compoundName.slice(connector.id.length + 1));
    if (!tool) throw new ConnectorError("TOOL_NOT_FOUND", "未找到该连接器能力。");
    return { connector, tool };
  }

  private require(id: string) {
    const connector = this.repository.find(id);
    if (!connector) throw new ConnectorError("CONFIG_INVALID", "连接器不存在。");
    return connector;
  }

  private toDto(connector: ReturnType<ConnectorRepository["find"]> extends infer T ? Exclude<T, null> : never): ConnectorDto {
    return { ...connector, status: this.runtime.status(connector.id, connector.enabled), toolCount: this.repository.listTools(connector.id).length };
  }

  private validate(input: CreateConnectorInput): void {
    if (!input.name?.trim()) throw new ConnectorError("CONFIG_INVALID", "请输入连接器名称。");
    if (input.scopeType === "workspace" && !input.scopeId) throw new ConnectorError("CONFIG_INVALID", "工作空间连接器必须选择工作空间。");
    if (input.config.transport === "stdio" && !input.config.command?.trim()) throw new ConnectorError("CONFIG_INVALID", "请输入启动命令。");
    if (input.config.transport !== "stdio" && !input.config.url?.trim()) throw new ConnectorError("CONFIG_INVALID", "请输入 MCP 服务地址。");
    for (const [key, ref] of [...Object.entries(input.config.env ?? {}), ...Object.entries(input.config.headers ?? {})]) {
      if (SECRET_KEY.test(key) && ref.source === "literal") throw new ConnectorError("CONFIG_INVALID", `${key} 看起来是敏感字段，请使用凭据输入。`);
    }
  }

  private assignCredentialRef(config: McpConnectorConfig, fieldPath: string, credentialId: string): void {
    const [group, ...parts] = fieldPath.split(".");
    const key = parts.join(".");
    if ((group !== "env" && group !== "headers") || !key) throw new ConnectorError("CONFIG_INVALID", "凭据字段路径无效。");
    const record = group === "env" ? (config.env ??= {}) : (config.headers ??= {});
    record[key] = { source: "credential", credentialId };
  }

  private credentialRefs(config: McpConnectorConfig) {
    const refs: Array<[string, { source: "credential"; credentialId: string; format?: string }]> = [];
    for (const group of ["env", "headers"] as const) for (const [key, ref] of Object.entries(config[group] ?? {})) if (ref.source === "credential") refs.push([`${group}.${key}`, ref]);
    return refs;
  }
}
