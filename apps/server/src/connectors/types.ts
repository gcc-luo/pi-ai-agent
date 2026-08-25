import type {
  ConnectorLifecycle, ConnectorScopeType, ConnectorToolPolicy, McpConnectorConfig,
} from "@pi-web-ui/shared";

export type ConnectorErrorCode =
  | "CONFIG_INVALID" | "COMMAND_NOT_FOUND" | "PROCESS_START_FAILED"
  | "CONNECTION_FAILED" | "TIMEOUT" | "AUTH_REQUIRED" | "AUTH_EXPIRED"
  | "MCP_INITIALIZE_FAILED" | "TOOL_NOT_FOUND" | "TOOL_DISABLED"
  | "TOOL_CALL_FAILED"
  | "POLICY_DENIED" | "USER_REJECTED" | "SESSION_CONTEXT_MISSING"
  | "SERVER_DISCONNECTED" | "RESULT_TOO_LARGE" | "INTERNAL_ERROR";

export interface StoredConnector {
  id: string;
  name: string;
  description: string | null;
  icon: string;
  protocol: "mcp";
  builtinKey: string | null;
  scopeType: ConnectorScopeType;
  scopeId: string | null;
  enabled: boolean;
  lifecycle: ConnectorLifecycle;
  config: McpConnectorConfig;
  lastConnectedAt: number | null;
  lastErrorCode: string | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ConnectorInvocationContext {
  sessionId: string;
  workspaceId: string;
  source: "desktop" | "wechat" | "dingtalk" | "api" | "automation";
  cwd: string;
}

export class ConnectorError extends Error {
  constructor(public readonly code: ConnectorErrorCode, message: string, public readonly detail?: string) {
    super(message);
  }
}

export interface InvocationAuditInput {
  context: ConnectorInvocationContext;
  connectorId: string;
  toolName: string;
  policy: ConnectorToolPolicy;
  approval: string;
  status: string;
  durationMs: number;
  errorCode?: string;
  argumentKeys: string[];
}
