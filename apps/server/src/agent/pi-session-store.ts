import fs from "node:fs";
import path from "node:path";

export type PiTranscriptMessage = {
  entryId: string;
  role: "user" | "assistant" | "toolResult";
  content: Record<string, unknown>[];
  provider?: string;
  model?: string;
  usage?: unknown;
  stopReason?: unknown;
  timestamp: number;
};

type PiJsonlEntry = {
  type?: string;
  id?: string;
  timestamp?: string | number;
  message?: {
    role?: "user" | "assistant" | "toolResult";
    content?: Record<string, unknown>[];
    provider?: string;
    model?: string;
    usage?: unknown;
    stopReason?: unknown;
    timestamp?: number;
  };
};

function safeSessionId(sessionId: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) throw new Error("invalid session id");
  return sessionId;
}

export function piSessionDirectory(sessionRootDir: string, sessionId: string): string {
  return path.join(sessionRootDir, safeSessionId(sessionId));
}

function findJsonlFiles(dir: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) return findJsonlFiles(target);
      return entry.isFile() && entry.name.endsWith(".jsonl") ? [target] : [];
    });
  } catch {
    return [];
  }
}

export function latestPiSessionFile(sessionDir: string): string | null {
  const files = findJsonlFiles(sessionDir);
  if (!files.length) return null;
  return files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] ?? null;
}

/**
 * Build Pi flags for one logical Web UI conversation. Pi can create a fresh
 * file itself, then future starts use --continue inside this isolated folder.
 */
export function preparePiSession(sessionRootDir: string, sessionId: string): { directory: string; args: string[] } {
  const directory = piSessionDirectory(sessionRootDir, sessionId);
  fs.mkdirSync(directory, { recursive: true });
  const args = ["--session-dir", directory];
  if (latestPiSessionFile(directory)) args.push("--continue");
  else args.push("--name", `pi-web-ui:${sessionId}`);
  return { directory, args };
}

export function readPiTranscript(sessionDir: string): PiTranscriptMessage[] {
  const file = latestPiSessionFile(sessionDir);
  if (!file) return [];
  try {
    return fs.readFileSync(file, "utf8").split("\n").flatMap((line): PiTranscriptMessage[] => {
      if (!line.trim()) return [];
      try {
        const entry = JSON.parse(line) as PiJsonlEntry;
        const message = entry.message;
        if (entry.type !== "message" || !entry.id || !message?.role || !Array.isArray(message.content)) return [];
        return [{
          entryId: entry.id,
          role: message.role,
          content: message.content,
          provider: message.provider,
          model: message.model,
          usage: message.usage,
          stopReason: message.stopReason,
          timestamp: typeof entry.timestamp === "number"
            ? entry.timestamp
            : typeof message.timestamp === "number" ? message.timestamp : Date.now(),
        }];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

export function removePiSession(sessionRootDir: string, sessionId: string): void {
  fs.rmSync(piSessionDirectory(sessionRootDir, sessionId), { recursive: true, force: true });
}
