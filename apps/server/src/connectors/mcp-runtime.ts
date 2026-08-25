import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import type { ConnectorStatus, McpConnectorConfig } from "@pi-web-ui/shared";
import type { FastifyBaseLogger } from "fastify";
import { CredentialVault } from "./credential-vault.js";
import { ConnectorError } from "./types.js";

interface Runtime {
  client: Client;
  transport: Transport;
  lastUsedAt: number;
  idleTimer?: NodeJS.Timeout;
}

function errorFor(error: unknown): ConnectorError {
  const detail = error instanceof Error ? error.message : String(error);
  if (/ENOENT|not found|cannot find/i.test(detail)) return new ConnectorError("COMMAND_NOT_FOUND", "未找到启动命令，请确认已安装或填写完整路径。", detail);
  if (/401|403|unauthor|forbidden/i.test(detail)) return new ConnectorError("AUTH_REQUIRED", "连接器授权无效，请重新配置凭据。", detail);
  if (/timeout|timed out|abort/i.test(detail)) return new ConnectorError("TIMEOUT", "连接超时，请检查服务地址或网络。", detail);
  return new ConnectorError("CONNECTION_FAILED", "无法连接 MCP 服务，请检查配置。", detail);
}

export function mapMcpCallError(error: unknown): ConnectorError {
  const detail = error instanceof Error ? error.message : String(error);
  if (!(error instanceof McpError)) return errorFor(error);
  if (error.code === ErrorCode.ConnectionClosed) {
    return new ConnectorError("SERVER_DISCONNECTED", "MCP 服务连接已断开，请重试。", detail);
  }
  if (error.code === ErrorCode.RequestTimeout) {
    return new ConnectorError("TIMEOUT", "MCP 工具调用超时，请稍后重试。", detail);
  }
  if (/unauthor|forbidden|token\s*(?:invalid|expired)/i.test(detail)) {
    return new ConnectorError("AUTH_REQUIRED", "连接器授权无效，请重新配置凭据。", detail);
  }
  const business = detail.match(/\bcode\s*:\s*([\w-]+)\s*,\s*msg\s*:\s*([^,\n]+?)(?=\s*,\s*(?:trace_id|request_id)\s*:|$)/i);
  const message = business
    ? `外部服务调用失败：${business[2]!.trim()}（错误码 ${business[1]}）`
    : `MCP 工具调用失败：${detail.replace(/^MCP error\s+-?\d+\s*:\s*/i, "").slice(0, 300)}`;
  return new ConnectorError("TOOL_CALL_FAILED", message, detail);
}

export class McpRuntimeManager {
  private readonly runtimes = new Map<string, Runtime>();
  private readonly connecting = new Map<string, Promise<Runtime>>();
  private readonly states = new Map<string, ConnectorStatus>();

  constructor(private readonly vault: CredentialVault, private readonly log: FastifyBaseLogger) {}

  status(id: string, enabled: boolean): ConnectorStatus {
    if (!enabled) return "disabled";
    return this.states.get(id) ?? "disconnected";
  }

  async connect(id: string, config: McpConnectorConfig): Promise<Runtime> {
    const current = this.runtimes.get(id);
    if (current) {
      current.lastUsedAt = Date.now();
      this.armIdle(id, current, config.idleTimeoutMs);
      return current;
    }
    const pending = this.connecting.get(id);
    if (pending) return pending;
    const promise = this.open(id, config);
    this.connecting.set(id, promise);
    try { return await promise; } finally { this.connecting.delete(id); }
  }

  async discover(id: string, config: McpConnectorConfig) {
    const runtime = await this.connect(id, config);
    const result = await runtime.client.listTools();
    runtime.lastUsedAt = Date.now();
    return result.tools.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
    }));
  }

  async call(id: string, config: McpConnectorConfig, name: string, args: Record<string, unknown>) {
    const runtime = await this.connect(id, config);
    try {
      const result = await runtime.client.callTool({ name, arguments: args });
      runtime.lastUsedAt = Date.now();
      this.armIdle(id, runtime, config.idleTimeoutMs);
      return result;
    } catch (error) {
      await this.disconnect(id);
      throw mapMcpCallError(error);
    }
  }

  async reconnect(id: string, config: McpConnectorConfig): Promise<void> {
    await this.disconnect(id);
    await this.connect(id, config);
  }

  async disconnect(id: string): Promise<void> {
    const runtime = this.runtimes.get(id);
    this.runtimes.delete(id);
    this.states.set(id, "disconnected");
    if (!runtime) return;
    if (runtime.idleTimer) clearTimeout(runtime.idleTimer);
    try { await runtime.client.close(); } catch (error) {
      this.log.debug({ connectorId: id, error: String(error) }, "connector close failed");
    }
  }

  async shutdown(): Promise<void> {
    await Promise.all([...this.runtimes.keys()].map((id) => this.disconnect(id)));
  }

  private async open(id: string, config: McpConnectorConfig): Promise<Runtime> {
    this.states.set(id, "connecting");
    try {
      const resolved = this.resolveConfig(config);
      const transport = this.createTransport(resolved);
      const client = new Client({ name: "pi-web-ui", version: "1.0.0" }, { capabilities: {} });
      const timeoutMs = Math.max(1_000, Math.min(config.timeoutMs ?? 30_000, 120_000));
      await Promise.race([
        client.connect(transport),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("connection timeout")), timeoutMs)),
      ]);
      const runtime: Runtime = { client, transport, lastUsedAt: Date.now() };
      transport.onclose = () => {
        if (this.runtimes.get(id) === runtime) this.runtimes.delete(id);
        this.states.set(id, "disconnected");
      };
      transport.onerror = (error) => this.log.warn({ connectorId: id, error: error.message }, "MCP transport error");
      this.runtimes.set(id, runtime);
      this.states.set(id, "connected");
      this.armIdle(id, runtime, config.idleTimeoutMs);
      return runtime;
    } catch (error) {
      const mapped = error instanceof ConnectorError ? error : errorFor(error);
      this.states.set(id, mapped.code === "AUTH_REQUIRED" ? "auth_required" : "error");
      throw mapped;
    }
  }

  private resolveConfig(config: McpConnectorConfig): McpConnectorConfig & { resolvedEnv: Record<string, string>; resolvedHeaders: Record<string, string> } {
    const resolve = (ref: NonNullable<McpConnectorConfig["env"]>[string]): string => {
      if (ref.source === "literal") return ref.value;
      if (ref.source === "env") return process.env[ref.name] ?? "";
      const value = this.vault.resolve(ref.credentialId);
      return ref.format ? ref.format.replace("{value}", value) : value;
    };
    return {
      ...config,
      resolvedEnv: Object.fromEntries(Object.entries(config.env ?? {}).map(([key, ref]) => [key, resolve(ref)])),
      resolvedHeaders: Object.fromEntries(Object.entries(config.headers ?? {}).map(([key, ref]) => [key, resolve(ref)])),
    };
  }

  private createTransport(config: McpConnectorConfig & { resolvedEnv: Record<string, string>; resolvedHeaders: Record<string, string> }): Transport {
    if (config.transport === "stdio") {
      if (!config.command?.trim()) throw new ConnectorError("CONFIG_INVALID", "请输入启动命令。");
      return new StdioClientTransport({
        command: config.command,
        args: config.args ?? [],
        cwd: config.cwd,
        env: { ...process.env, ...config.resolvedEnv } as Record<string, string>,
        stderr: "pipe",
      });
    }
    if (!config.url) throw new ConnectorError("CONFIG_INVALID", "请输入 MCP 服务地址。");
    let url: URL;
    try { url = new URL(config.url); } catch { throw new ConnectorError("CONFIG_INVALID", "MCP 服务地址格式无效。"); }
    if (!/^https?:$/.test(url.protocol)) throw new ConnectorError("CONFIG_INVALID", "远程连接器只支持 HTTP 或 HTTPS 地址。");
    const headers = config.resolvedHeaders;
    if (config.transport === "sse") {
      return new SSEClientTransport(url, {
        eventSourceInit: { fetch: (input: URL | RequestInfo, init?: RequestInit) => fetch(input, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers).entries()), ...headers } }) } as any,
        requestInit: { headers },
      });
    }
    return new StreamableHTTPClientTransport(url, { requestInit: { headers } });
  }

  private armIdle(id: string, runtime: Runtime, timeout = 600_000): void {
    if (runtime.idleTimer) clearTimeout(runtime.idleTimer);
    runtime.idleTimer = setTimeout(() => void this.disconnect(id), Math.max(10_000, timeout));
    runtime.idleTimer.unref();
  }
}
