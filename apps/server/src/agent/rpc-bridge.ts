import { Writable, Readable } from "node:stream";
import { EventEmitter } from "node:events";
import { ServerEvent, ToolCall } from "@pi-web-ui/shared";

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
    const sid = this.sessionId;

    if (input?.type === "response") {
      if (input.success === false) {
        return [{
          type: "error",
          sessionId: sid,
          code: `pi_${input.command ?? "command"}_failed`,
          message: input.error ?? "pi command failed",
        }];
      }
      return [];
    }

    if (input?.type === "message_start") {
      const message = input.message;
      if (message?.role !== "assistant") return [];
      const messageId = `assistant-${message.timestamp ?? Date.now()}`;
      this.activeAssistantMessageId = messageId;
      return [{ type: "message_start", sessionId: sid, messageId, role: "assistant" }];
    }

    if (input?.type === "message_update") {
      const messageId = this.activeAssistantMessageId;
      if (!messageId) return [];
      const ae = input.assistantMessageEvent;
      if (!ae) return [];
      if (ae.type === "text_delta" && ae.delta) {
        return [{ type: "message_delta", sessionId: sid, messageId, delta: ae.delta }];
      }
      if (ae.type === "thinking_delta" && ae.delta) {
        return [{ type: "thinking_delta", sessionId: sid, messageId, delta: ae.delta }];
      }
      if (ae.type === "toolcall_end" && ae.toolCall) {
        return [{
          type: "tool_call",
          sessionId: sid,
          messageId,
          name: ae.toolCall.name,
          args: ae.toolCall.arguments,
          toolCallId: ae.toolCall.id,
        }];
      }
      // text_start/end, thinking_start/end, toolcall_start/delta, start, done, error:
      // forward as raw so the full process is visible.
      return [{ type: "raw", sessionId: sid, data: input }];
    }

    if (input?.type === "message_end") {
      const message = input.message;
      if (message?.role !== "assistant") return [];
      const messageId = this.activeAssistantMessageId ?? `assistant-${message.timestamp ?? Date.now()}`;
      // Keep activeAssistantMessageId set so tool_execution_start (which fires after
      // message_end) attaches to the assistant message that triggered the tool.
      const toolCalls = this.extractToolCalls(message);
      return [{
        type: "message_end",
        sessionId: sid,
        messageId,
        content: this.messageText(message),
        metadata: {
          provider: message.provider,
          model: message.model,
          usage: message.usage,
          stopReason: message.stopReason,
          toolCalls,
          // Keep the ordered Pi content blocks intact. A tool-use turn commonly
          // has no text at all, so reducing it to messageText() makes it appear
          // as an empty assistant bubble in the UI.
          messageParts: this.messageParts(message),
        },
      }];
    }

    if (input?.type === "tool_execution_start") {
      return [{
        type: "tool_call",
        sessionId: sid,
        messageId: this.activeAssistantMessageId ?? "unknown",
        name: input.toolName,
        args: input.args,
        toolCallId: input.toolCallId,
      }];
    }

    if (input?.type === "tool_execution_update") {
      return [{ type: "tool_progress", sessionId: sid, toolCallId: input.toolCallId, partial: input.partialResult }];
    }

    if (input?.type === "tool_execution_end") {
      return [{ type: "tool_result", sessionId: sid, toolCallId: input.toolCallId, result: input.result }];
    }

    // Catch-all: forward any unhandled event (agent_start, turn_start, compaction_start,
    // queue_update, extension_ui_request, etc.) as raw so nothing is hidden.
    return [{ type: "raw", sessionId: sid, data: input as Record<string, unknown> }];
  }

  private extractToolCalls(message: any): ToolCall[] {
    if (!Array.isArray(message?.content)) return [];
    return message.content
      .filter((p: any) => p?.type === "toolCall" && p.id)
      .map((p: any) => ({
        toolCallId: p.id,
        name: p.name,
        args: p.arguments,
        status: "complete" as const,
      }));
  }

  private messageParts(message: any): Record<string, unknown>[] {
    if (!Array.isArray(message?.content)) return [];
    return message.content
      .filter((part: any) => part && typeof part === "object")
      .map((part: any) => ({ ...part }));
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
