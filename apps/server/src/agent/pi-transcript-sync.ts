import type { MessageRepository } from "../db/repositories/message.js";
import { readPiTranscript, type PiTranscriptMessage } from "./pi-session-store.js";

function textFromParts(parts: Record<string, unknown>[]): string {
  return parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("");
}

function metadataFor(entry: PiTranscriptMessage): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    piEntryId: entry.entryId,
    provider: entry.provider,
    model: entry.model,
    usage: entry.usage,
    stopReason: entry.stopReason,
  };
  // Office mode deliberately keeps the user's original wording in SQLite;
  // Pi may have received invisible KB, expert, or artifact instructions around
  // it. Assistant content has no such presentation-only transformation.
  if (entry.role === "assistant") metadata.messageParts = entry.content.map((part) => ({ ...part }));
  return metadata;
}

/**
 * Materialize Pi's canonical JSONL transcript into the SQLite rows used by the
 * office UI. Existing office rows are matched first, preserving Web-only
 * metadata such as images and knowledge-base citations.
 */
export function syncPiTranscript(input: {
  sessionId: string;
  sessionDir: string;
  repository: MessageRepository;
}): void {
  const transcript = readPiTranscript(input.sessionDir);
  if (!transcript.length) return;

  const persisted = input.repository.listBySession(input.sessionId);
  const byEntryId = new Map<string, typeof persisted[number]>();
  const unmatched = new Set<string>();
  for (const message of persisted) {
    const entryId = typeof message.metadata?.piEntryId === "string" ? message.metadata.piEntryId : null;
    if (entryId) byEntryId.set(entryId, message);
    else unmatched.add(message.id);
  }
  for (const entry of transcript) {
    if (entry.role === "toolResult") continue;
    if (entry.role !== "user" && entry.role !== "assistant") continue;

    const content = textFromParts(entry.content);
    const incomingMetadata = metadataFor(entry);
    let stored = byEntryId.get(entry.entryId);
    if (!stored) {
      stored = persisted.find((message) => {
        if (!unmatched.has(message.id) || message.role !== entry.role) return false;
        const savedContent = message.content ?? "";
        if (savedContent === content) return true;
        // The office transport wraps user input in hidden context before
        // sending it to Pi. Match the original visible text without rendering
        // those injected instructions as a second user message.
        return entry.role === "user" && savedContent.length > 0 && content.includes(savedContent);
      });
      if (stored) unmatched.delete(stored.id);
    }

    if (stored) {
      const visibleContent = entry.role === "user" && (stored.content ?? "") !== content
        ? (stored.content ?? "")
        : content;
      const metadata = { ...(stored.metadata ?? {}), ...incomingMetadata };
      input.repository.replaceContentAndMetadata(stored.id, visibleContent, metadata);
      input.repository.updateCreatedAt(stored.id, entry.timestamp);
      stored = { ...stored, content: visibleContent, metadata, createdAt: entry.timestamp };
      byEntryId.set(entry.entryId, stored);
    } else {
      stored = input.repository.append({
        sessionId: input.sessionId,
        role: entry.role,
        content,
        metadata: incomingMetadata,
        createdAt: entry.timestamp,
      });
      byEntryId.set(entry.entryId, stored);
    }
  }
}
