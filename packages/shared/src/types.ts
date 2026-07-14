// WebSocket events: client → server
export type ClientEvent =
  | { type: "send"; sessionId: string; content: string }
  | { type: "interrupt"; sessionId: string }
  | { type: "steer"; sessionId: string; content: string }
  | { type: "switchModel"; sessionId: string; model: string }
  | { type: "ping" };

// WebSocket events: server → client
export type ServerEvent =
  | { type: "message_start"; sessionId: string; messageId: string; role: "user" | "assistant"; timestamp?: number }
  | { type: "message_delta"; sessionId: string; messageId: string; delta: string }
  | { type: "thinking_delta"; sessionId: string; messageId: string; delta: string }
  | { type: "message_end"; sessionId: string; messageId: string; content: string; metadata?: Record<string, unknown>; timestamp?: number }
  | { type: "tool_call"; sessionId: string; messageId: string; name: string; args: unknown; toolCallId: string }
  | { type: "tool_progress"; sessionId: string; toolCallId: string; partial: unknown }
  | { type: "tool_result"; sessionId: string; toolCallId: string; result: unknown }
  | { type: "file_changed"; sessionId: string; toolCallId: string; toolName: string }
  // A run spans every model turn and tool execution triggered by one prompt.
  // It deliberately does not mirror `message_start`/`message_end`, because an
  // agent run can contain several assistant messages.
  | { type: "agent_status"; sessionId: string; status: "working" | "idle" }
  | { type: "session_status"; sessionId: string; status: SessionStatus }
  | { type: "session_updated"; session: SessionDto }
  | { type: "error"; sessionId?: string; code: string; message: string }
  | { type: "raw"; sessionId: string; data: Record<string, unknown> }
  | { type: "pong" };

export interface ToolCall {
  toolCallId: string;
  name: string;
  args: unknown;
  result?: unknown;
  status: "running" | "complete";
}

export type MessagePart =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool_call"; toolCallId: string; name: string; args: unknown; status: "running" | "complete"; result?: unknown; progress?: unknown[] }
  | { kind: "raw"; data: Record<string, unknown> };

export type SessionStatus = "active" | "idle" | "suspended" | "crashed";

// REST DTOs
export interface ProjectDto {
  id: string;
  name: string;
  workdir: string;
  description: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface SessionDto {
  id: string;
  projectId: string;
  title: string | null;
  parentId: string | null;
  status: SessionStatus;
  createdAt: number;
  updatedAt: number;
  lastActiveAt: number | null;
}

export interface MessageDto {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "tool";
  content: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: number;
  seq: number;
}

export interface FileNodeDto {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  children?: FileNodeDto[];
}

export interface FileContentDto {
  path: string;
  content: string;
  size: number;
  mtime: number;
}

export type ModelType = "text" | "multimodal" | "vector";

export interface ModelDto {
  id: string;
  label: string;
  provider: string;
  modelType: ModelType;
  apiBaseUrl: string | null;
  apiKey: string | null;
  hasApiKey: boolean;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SkillDto {
  name: string;
  description: string;
  path: string;
}

// ─── Skill store (vendored pi-skill-hub provider DTOs) ───
// These mirror the structures returned by pi-skill-hub's skills.sh and
// SkillsMP providers. See apps/server/src/skill-store/vendor/ATTRIBUTION.md.

export type SkillProviderId = "skills-sh" | "skillsmp" | "github";
export type SkillSearchMode = "keyword" | "ai";

export interface SkillSearchResult {
  id: string;
  name: string;
  author: string;
  description: string;
  popularity: number;
  provider: SkillProviderId;
  sourceUrl?: string | null;
  githubUrl?: string | null;
  sourceOwner?: string | null;
  sourceRepository?: string | null;
  sourcePath?: string | null;
  installHint?: string | null;
  installReference?: string | null;
}

export type SkillPreviewAuditStatus = "pass" | "fail" | "warning" | "unknown";
export type SkillPreviewMetadataStatus = "available" | "partial" | "unavailable";

export interface SkillPreviewAudit {
  label: string;
  status: SkillPreviewAuditStatus;
}

export interface SkillPreviewMetadata {
  provider: SkillProviderId;
  weeklyInstalls?: number | null;
  githubStars?: number | null;
  securityAudits: SkillPreviewAudit[];
  status: SkillPreviewMetadataStatus;
}

export interface SkillContentPreview {
  title: string;
  body: string;
  source: "remote" | "metadata";
  limitation?: string | null;
  metadata: SkillPreviewMetadata;
}

export interface SkillStoreSearchResponse {
  query: string;
  results: SkillSearchResult[];
  errors: { provider: string; message: string }[];
}

export interface SkillStoreInstallRequest {
  skill: SkillSearchResult;
  localName?: string;
}

export interface SkillStoreInstallResponse {
  name: string;
  path: string;
}

export interface Result<T, E = string> {
  ok: boolean;
  data?: T;
  error?: E;
}
