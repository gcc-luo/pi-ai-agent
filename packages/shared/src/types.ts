// Image attachment for multimodal messages
export interface ImageAttachment {
  name: string;
  mediaType: string;  // "image/png" | "image/jpeg" | "image/gif" | "image/webp"
  data: string;       // base64-encoded (no data: URI prefix)
}

// WebSocket events: client → server
export type ClientEvent =
  | { type: "send"; sessionId: string; content: string; model?: string; images?: ImageAttachment[] }
  | { type: "interrupt"; sessionId: string }
  | { type: "permission_response"; sessionId: string; requestId: string; approved: boolean }
  | { type: "steer"; sessionId: string; content: string }
  | { type: "switchModel"; sessionId: string; model: string }
  | { type: "subscribe"; sessionId: string }
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
  | {
      type: "agent_status";
      sessionId: string;
      status: "working" | "idle";
      /** Total time spent by the just-settled agent run. */
      durationMs?: number;
    }
  | {
      type: "context_compaction";
      sessionId: string;
      phase: "started" | "completed" | "failed";
      reason: "manual" | "threshold" | "overflow";
      tokensBefore?: number;
      estimatedTokensAfter?: number;
      willRetry?: boolean;
      error?: string;
    }
  | { type: "session_status"; sessionId: string; status: SessionStatus }
  | { type: "session_updated"; session: SessionDto }
  | { type: "model_changed"; sessionId: string; provider: string; model: string }
  | { type: "error"; sessionId?: string; code: string; message: string }
  | { type: "raw"; sessionId: string; data: Record<string, unknown> }
  | {
      type: "kb_search";
      sessionId: string;
      messageId: string;
      phase: "searching" | "done" | "empty" | "failed";
      query: string;
      kbIds: string[];
      fileIds?: string[];
      hits?: KbSearchHitDto[];
      chunkMap?: Record<number, ChunkMeta>;
      durationMs?: number;
      error?: string;
    }
  | { type: "pong" }
  | {
      type: "permission_request";
      sessionId: string;
      requestId: string;
      pluginId: string;
      action: string;
      reason: string;
      intent?: string;
      context?: {
        url?: string;
        target?: string;
        windowId?: string;
        files?: string[];
      };
      expiresAt: number;
    };

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
  | { kind: "image"; name: string; mediaType: string; data: string }
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
  deletedAt: number | null;
}

export interface SessionDto {
  id: string;
  projectId: string;
  title: string | null;
  parentId: string | null;
  expertId: string | null;
  /** Plugins explicitly exposed to this session's Pi process. */
  selectedPluginIds: string[];
  /** @deprecated Compatibility mirror for the legacy Browser capability API. */
  browserEnabled: boolean;
  status: SessionStatus;
  createdAt: number;
  updatedAt: number;
  lastActiveAt: number | null;
  deletedAt: number | null;
}

export type BrowserCapabilityStatus =
  | "disabled"
  | "starting"
  | "running"
  | "error"
  | "closed";

export interface BrowserCapabilityDto {
  enabled: boolean;
  status: BrowserCapabilityStatus;
  pageCount: number;
  currentUrl: string | null;
  error: string | null;
}

export type PluginStatus =
  | "disabled"
  | "enabled"
  | "starting"
  | "running"
  | "error"
  | "unavailable";

export interface PluginDto {
  id: string;
  name: string;
  icon: string;
  version: string;
  description: string;
  source: string;
  builtin: boolean;
  official: boolean;
  enabled: boolean;
  status: PluginStatus;
  tools: string[];
  skills: string[];
  capabilities: string[];
  permissions: string[];
  supportedPlatforms: string[];
  settings: Record<string, unknown>;
  error: string | null;
  updatedAt: number;
}

export interface PluginAuditDto {
  id: string;
  pluginId: string;
  sessionId: string | null;
  action: string;
  risk: "normal" | "sensitive" | "destructive";
  approved: boolean;
  success: boolean;
  details: Record<string, unknown>;
  createdAt: number;
}

export interface TrashItemDto {
  kind: "project" | "session";
  id: string;
  name: string;
  subtitle: string | null;
  deletedAt: number;
  projectId: string;
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

export type ModelType = "text" | "multimodal" | "embedding";

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

// ─── Expert Center ───

export type ExpertCategory =
  | "development" | "design" | "data" | "marketing"
  | "product" | "finance" | "legal" | "operations";

export interface ExpertDto {
  id: string;
  name: string;
  icon: string;
  category: ExpertCategory;
  description: string;
  systemPrompt: string;
  tags: string[];
  isPreset: boolean;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
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

// ─── Knowledge Base ───

export interface KbDto {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  embeddingModelId: string | null;
  createdAt: number;
  updatedAt: number;
  fileCount: number;
  searchableFileCount: number;
  failedFileCount: number;
  chunkCount: number;
}

export interface KbFileDto {
  id: string;
  kbId: string;
  name: string;
  ext: string;
  source: string;
  assetKind: "document" | "image" | "video" | "audio";
  size: number;
  status: "pending" | "parsing" | "ready" | "failed";
  enabled: boolean;
  parseGeneration: number;
  activeRevisionId: string | null;
  failReason: string | null;
  charCount: number | null;
  pageCount: number | null;
  chunkCount: number | null;
  lastParsedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface KbFilePage {
  items: KbFileDto[];
  total: number;
  page: number;
  pageSize: number;
  /** KB 内是否存在 pending/parsing 文件，用于驱动客户端轮询 */
  hasActive: boolean;
}

export interface KbChunkDto {
  id: number;
  segmentId: string;
  kbId: string;
  fileId: string;
  seq: number;
  titlePath: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  content: string;
  charCount: number;
  modality: "text" | "image" | "video" | "audio";
  timeStartMs: number | null;
  timeEndMs: number | null;
  bbox: { x: number; y: number; width: number; height: number } | null;
  parentChunkId: number | null;
  createdAt: number;
}

export interface KbBindingDto {
  kbId: string;
  enabled: boolean;
  fileFilter: string[] | null;
  boundAt: number;
}

export interface KbSearchHitDto {
  chunkId: number;
  /** Stable identifier for this segment revision. */
  segmentId: string;
  revision: number;
  kbId: string;
  kbName: string;
  fileId: string;
  fileName: string;
  seq: number;
  titlePath: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  modality: "text" | "image" | "video" | "audio";
  timeStartMs: number | null;
  timeEndMs: number | null;
  bbox: { x: number; y: number; width: number; height: number } | null;
  content: string;
  snippet: string;
  score: number;
  keywordScore?: number;
  vectorScore?: number;
}

export interface ChunkMeta {
  chunkId: number;
  segmentId?: string;
  revision?: number;
  kbName: string;
  fileName: string;
  titlePath: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  modality?: "text" | "image" | "video" | "audio";
  timeStartMs?: number | null;
  timeEndMs?: number | null;
}

export interface Result<T, E = string> {
  ok: boolean;
  data?: T;
  error?: E;
}

// ─── Scheduled Tasks ───

export type TaskType = "prompt" | "reminder";

export interface ScheduledTaskDto {
  id: string;
  name: string;
  description: string;
  cronExpression: string;
  taskType: TaskType;
  /** JSON string — type-specific config (prompt text, reminder message, etc.) */
  payload: string;
  /** Project where prompt tasks create sessions. Null for reminder tasks. */
  projectId: string | null;
  /** When true, each execution creates a new session. When false (default), reuse the same session. */
  createNewSession: boolean;
  /** Persistent session ID for reuse mode. Set after first execution when createNewSession is false. */
  sessionId: string | null;
  enabled: boolean;
  lastRunAt: number | null;
  nextRunAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface TaskLogDto {
  id: string;
  taskId: string;
  status: "success" | "failed" | "running";
  output: string;
  /** Session created for this execution (prompt tasks only). */
  sessionId: string | null;
  startedAt: number;
  finishedAt: number | null;
}

// ─── Artifact Delivery ───

/** A file declared by the agent in an <artifacts> block. */
export interface ArtifactItem {
  /** Relative path from the project workdir. */
  path: string;
  /** Display file name. */
  name: string;
  /** MIME type (e.g. "text/typescript", "image/png"). */
  mimeType: string;
}

/** Backend validation result for a single artifact. */
export interface ArtifactValidation {
  path: string;
  exists: boolean;
  /** File size in bytes. Null when the file does not exist. */
  size: number | null;
  mimeType: string;
}

// ─── Channels ───

export type ChannelType = "dingtalk" | "wecom" | "wechat";

export type ChannelConfigField =
  | { kind: "string"; key: string; label: string; required?: boolean; placeholder?: string; secret?: boolean }
  | { kind: "text"; key: string; label: string; required?: boolean; placeholder?: string; secret?: boolean }
  | { kind: "boolean"; key: string; label: string };

export interface ChannelDescriptor {
  type: ChannelType;
  label: string;
  /** Emoji or short text shown next to the label on the card. */
  icon: string;
  description: string;
  /** false marks the channel as a placeholder (no config flow yet). */
  available: boolean;
  configSchema: ChannelConfigField[];
}

export interface ChannelConfigDto {
  id: string;
  type: ChannelType;
  name: string;
  enabled: boolean;
  config: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface ChannelTestResult {
  ok: boolean;
  error?: string;
}
