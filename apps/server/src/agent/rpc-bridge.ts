import { Writable, Readable } from "node:stream";
import { EventEmitter } from "node:events";
import { ServerEvent } from "@pi-web-ui/shared";

export interface RpcProcess {
  stdin: Writable;
  stdout: Readable;
}

export class RpcBridge extends EventEmitter {
  private buffer = "";
  private activeAssistantMessageId: string | null = null;

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
        const events = this.toServerEvents(JSON.parse(line));
        for (const event of events) this.emitEvent(event);
      } catch {
        // malformed, ignore
      }
    }
  }

  private toServerEvents(input: any): ServerEvent[] {
    if (input?.type === "response") {
      if (input.success === false) {
        return [{
          type: "error",
          sessionId: this.sessionId,
          code: `pi_${input.command ?? "command"}_failed`,
          message: input.error ?? "pi command failed",
        }];
      }
      return [];
    }

    if (input?.sessionId && input?.messageId) {
      return [input as ServerEvent];
    }

    if (input?.type === "message_start") {
      const message = input.message;
      if (message?.role !== "assistant") return [];
      const messageId = `assistant-${message.timestamp ?? Date.now()}`;
      this.activeAssistantMessageId = messageId;
      return [{ type: "message_start", sessionId: this.sessionId, messageId, role: "assistant" }];
    }

    if (input?.type === "message_update") {
      const messageId = this.activeAssistantMessageId;
      const assistantEvent = input.assistantMessageEvent;
      if (!messageId || assistantEvent?.type !== "text_delta" || !assistantEvent.delta) return [];
      return [{ type: "message_delta", sessionId: this.sessionId, messageId, delta: assistantEvent.delta }];
    }

    if (input?.type === "message_end") {
      const message = input.message;
      if (message?.role !== "assistant") return [];
      const messageId = this.activeAssistantMessageId ?? `assistant-${message.timestamp ?? Date.now()}`;
      this.activeAssistantMessageId = null;
      return [{
        type: "message_end",
        sessionId: this.sessionId,
        messageId,
        content: this.messageText(message),
        metadata: {
          provider: message.provider,
          model: message.model,
          usage: message.usage,
          stopReason: message.stopReason,
        },
      }];
    }

    if (input?.type === "tool_execution_start") {
      return [{
        type: "tool_call",
        sessionId: this.sessionId,
        messageId: this.activeAssistantMessageId ?? "unknown",
        name: input.toolName,
        args: input.args,
        toolCallId: input.toolCallId,
      }];
    }

    if (input?.type === "tool_execution_end") {
      return [{
        type: "tool_result",
        sessionId: this.sessionId,
        toolCallId: input.toolCallId,
        result: input.result,
      }];
    }

    return [];
  }

  private messageText(message: any): string {
    if (typeof message?.content === "string") return message.content;
    if (!Array.isArray(message?.content)) return "";
    return message.content
      .filter((part: any) => part?.type === "text" && typeof part.text === "string")
      .map((part: any) => part.text)
      .join("");
  }

  onEvent(listener: (e: ServerEvent) => void): void {
    this.on("event", listener);
  }

  emitEvent(event: ServerEvent): void {
    this.emit("event", event);
  }

  send(command: object): void {
    this.proc.stdin.write(JSON.stringify(this.toPiCommand(command as any)) + "\n");
  }

  private toPiCommand(command: any): object {
    if (command?.type === "send") {
      return { type: "prompt", message: command.content };
    }
    if (command?.type === "steer") {
      return { type: "steer", message: command.content };
    }
    if (command?.type === "switchModel" && command.provider && command.model) {
      return { type: "set_model", provider: command.provider, modelId: command.model };
    }
    return command;
  }
}
