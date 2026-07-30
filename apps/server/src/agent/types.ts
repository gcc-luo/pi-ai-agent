import { Readable, Writable } from "node:stream";
import { ServerEvent } from "@pi-web-ui/shared";

export interface AgentProcess {
  sessionId: string;
  projectId: string;
  workdir: string;
  stdin: Writable;
  stdout: Readable;
  pid: number | undefined;
  startedAt: number;
  lastActivityAt: number;
  status: "starting" | "active" | "idle" | "suspended" | "crashed";
  browserEnabled?: boolean;
  on(event: "event", listener: (e: ServerEvent) => void): void;
  on(event: "exit", listener: (code: number | null) => void): void;
  on(event: "stderr", listener: (line: string) => void): void;
  off(event: string, listener: (...args: unknown[]) => void): void;
  writeCommand(command: object): void;
  kill(): void;
}

export interface SpawnOptions {
  sessionId: string;
  projectId: string;
  workdir: string;
  command: string;
  args: string[];
}
