import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { MessageDto, ToolCall } from "@pi-web-ui/shared";
import type { MessageRepository } from "../db/repositories/message.js";

type PiMessage = {
  role?: string;
  content?: Record<string, unknown>[];
  provider?: string;
  model?: string;
  usage?: unknown;
  stopReason?: unknown;
  timestamp?: number;
  /** JSONL 外层记录写入时间，即这条消息最终完成并落盘的时间。 */
  recordedAt?: number;
};

type PiEntry = { type?: string; timestamp?: string | number; message?: PiMessage };

function sessionDirectories(workdir: string): string[] {
  const root = path.join(os.homedir(), ".pi", "agent", "sessions");
  const normalized = workdir.replace(/^[/\\]+|[/\\]+$/g, "").replace(/[\\/]/g, "-");
  try {
    return fs.readdirSync(root)
      .filter((entry) => entry.includes(normalized))
      .map((entry) => path.join(root, entry));
  } catch {
    return [];
  }
}

function timestampFromFilename(filename: string): number | null {
  const match = filename.match(/^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3})Z_/);
  if (!match) return null;
  const timestamp = Date.parse(`${match[1]}:${match[2]}:${match[3]}.${match[4]}Z`);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function findPiSessionFile(workdir: string, createdAt: number): string | null {
  const candidates = sessionDirectories(workdir).flatMap((directory) => {
    try {
      return fs.readdirSync(directory)
        .filter((file) => file.endsWith(".jsonl"))
        .map((file) => ({ file: path.join(directory, file), timestamp: timestampFromFilename(file) }));
    } catch {
      return [];
    }
  });
  const closest = candidates
    .filter((entry): entry is { file: string; timestamp: number } => entry.timestamp !== null)
    .sort((a, b) => Math.abs(a.timestamp - createdAt) - Math.abs(b.timestamp - createdAt))[0];
  return closest?.file ?? null;
}

function readPiMessages(file: string): PiMessage[] {
  try {
    return fs.readFileSync(file, "utf8")
      .split("\n")
      .flatMap((line): PiMessage[] => {
        if (!line.trim()) return [];
        try {
          const entry = JSON.parse(line) as PiEntry;
          if (entry.type !== "message" || !entry.message) return [];
          const recordedAt = timestampFromJsonlEntry(entry.timestamp);
          return [{ ...entry.message, ...(recordedAt === null ? {} : { recordedAt }) }];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

function timestampFromJsonlEntry(value: string | number | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function textFromParts(parts: Record<string, unknown>[]): string {
  return parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("");
}

/**
 * Early versions of the web UI only persisted assistant text. Rehydrate those
 * records from Pi's canonical JSONL transcript when a historical session opens.
 * Always sync `created_at` from the JSONL so displayed times match Pi's final
 * record time, rather than the internal timestamp captured when a message began.
 */
export function restorePiHistory(input: {
  workdir: string;
  createdAt: number;
  messages: MessageDto[];
  repository: MessageRepository;
}): void {
  const missingParts = input.messages.some((message) => message.role === "assistant" && !Array.isArray(message.metadata?.messageParts));

  const sessionFile = findPiSessionFile(input.workdir, input.createdAt);
  if (!sessionFile) return;
  const piMessages = readPiMessages(sessionFile);

  // The JSONL entry timestamp is written after the message finishes. This is
  // especially important for the final assistant turn: its inner timestamp is
  // often the turn start time, while the record timestamp is the session's end.
  syncTimestamps(input.messages, piMessages, input.repository);

  if (!missingParts) return;

  const piAssistants = piMessages.filter((message) => message.role === "assistant");
  const savedAssistants = input.messages.filter((message) => message.role === "assistant");

  // A count mismatch means this is likely a different Pi session; never guess.
  if (!piAssistants.length || piAssistants.length !== savedAssistants.length) return;

  const metadataByCallId = new Map<string, Record<string, unknown>>();
  const metadataByMessageId = new Map<string, Record<string, unknown>>();
  for (let index = 0; index < savedAssistants.length; index++) {
    const piMessage = piAssistants[index];
    const saved = savedAssistants[index];
    if (!piMessage || !saved) continue;
    const messageParts = (piMessage.content ?? []).map((part) => ({ ...part }));
    const toolCalls: ToolCall[] = messageParts
      .filter((part) => part.type === "toolCall" && typeof part.id === "string" && typeof part.name === "string")
      .map((part) => ({
        toolCallId: part.id as string,
        name: part.name as string,
        args: part.arguments,
        status: "complete",
      }));
    const metadata: Record<string, unknown> = {
      ...(saved.metadata ?? {}),
      provider: piMessage.provider,
      model: piMessage.model,
      usage: piMessage.usage,
      stopReason: piMessage.stopReason,
      messageParts,
      toolCalls,
    };
    metadataByMessageId.set(saved.id, metadata);
    for (const toolCall of toolCalls) metadataByCallId.set(toolCall.toolCallId, metadata);
    input.repository.replaceContentAndMetadata(saved.id, textFromParts(messageParts), metadata);
  }

  for (const piMessage of piMessages) {
    if (piMessage.role !== "toolResult") continue;
    const toolCallId = (piMessage as PiMessage & { toolCallId?: unknown }).toolCallId;
    if (typeof toolCallId !== "string") continue;
    const metadata = metadataByCallId.get(toolCallId);
    if (!metadata) continue;
    const result = (piMessage.content ?? []).map((part) => ({ ...part }));
    metadata.toolCalls = (metadata.toolCalls as ToolCall[]).map((toolCall) =>
      toolCall.toolCallId === toolCallId ? { ...toolCall, result } : toolCall,
    );
    metadata.messageParts = (metadata.messageParts as Record<string, unknown>[]).map((part) =>
      part.type === "toolCall" && part.id === toolCallId ? { ...part, result } : part,
    );
  }

  // Tool results are attached after all JSONL entries have been visited.
  for (const saved of savedAssistants) {
    const metadata = metadataByMessageId.get(saved.id);
    if (metadata) input.repository.updateMetadata(saved.id, metadata);
  }
}

/**
 * Pair DB messages with JSONL messages by index within each role. When counts
 * match, overwrite `created_at` with the JSONL record time so displayed times
 * reflect when each turn actually completed. A count mismatch means this is likely a
 * different Pi session — skip rather than guess.
 */
function syncTimestamps(dbMessages: MessageDto[], piMessages: PiMessage[], repository: MessageRepository): void {
  for (const role of ["user", "assistant"] as const) {
    const pi = piMessages.filter((m) => m.role === role);
    const db = dbMessages.filter((m) => m.role === role);
    if (!pi.length || pi.length !== db.length) continue;
    for (let i = 0; i < db.length; i++) {
      const piMsg = pi[i];
      const dbMsg = db[i];
      if (!piMsg || !dbMsg) continue;
      const ts = piMsg.recordedAt ?? piMsg.timestamp;
      if (typeof ts === "number" && ts !== dbMsg.createdAt) {
        repository.updateCreatedAt(dbMsg.id, ts);
      }
    }
  }
}
