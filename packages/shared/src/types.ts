// WebSocket events: client → server
export type ClientEvent =
  | { type: "send"; sessionId: string; content: string }
  | { type: "interrupt"; sessionId: string }
  | { type: "steer"; sessionId: string; content: string }
  | { type: "switchModel"; sessionId: string; model: string }
  | { type: "ping" };

// WebSocket events: server → client
export type ServerEvent =
  | { type: "message_start"; sessionId: string; messageId: string; role: "user" | "assistant" }
  | { type: "message_delta"; sessionId: string; messageId: string; delta: string }
  | { type: "message_end"; sessionId: string; messageId: string; content: string; metadata?: Record<string, unknown> }
  | { type: "tool_call"; sessionId: string; messageId: string; name: string; args: unknown; toolCallId: string }
  | { type: "tool_result"; sessionId: string; toolCallId: string; result: unknown }
  | { type: "session_status"; sessionId: string; status: SessionStatus }
  | { type: "error"; sessionId?: string; code: string; message: string }
  | { type: "pong" };

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

export interface Result<T, E = string> {
  ok: boolean;
  data?: T;
  error?: E;
}
