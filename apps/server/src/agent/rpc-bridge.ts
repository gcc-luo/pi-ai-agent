import { Writable, Readable } from "node:stream";
import { EventEmitter } from "node:events";
import { ServerEvent } from "@pi-web-ui/shared";

export interface RpcProcess {
  stdin: Writable;
  stdout: Readable;
}

export class RpcBridge extends EventEmitter {
  private buffer = "";

  constructor(private proc: RpcProcess, private sessionId: string) {
    super();
    this.proc.stdout.setEncoding("utf8");
    this.proc.stdout.on("data", (chunk: string) => this.handleChunk(chunk));
  }

  private handleChunk(chunk: string) {
    this.buffer += chunk;
    let idx;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as ServerEvent;
        this.emitEvent(event);
      } catch {
        // malformed, ignore
      }
    }
  }

  onEvent(listener: (e: ServerEvent) => void): void {
    this.on("event", listener);
  }

  emitEvent(event: ServerEvent): void {
    this.emit("event", event);
  }

  send(command: object): void {
    this.proc.stdin.write(JSON.stringify(command) + "\n");
  }
}
