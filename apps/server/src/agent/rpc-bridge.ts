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
  private activeAssistantTimestamp: number | null = null;

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

    // These events describe the lifecycle of the complete agent run. They are
    // intentionally separate from assistant message boundaries, which can
    // occur many times during one prompt while tools are being used.
    if (input?.type === "agent_start") {
      console.log(`[RpcBridge] agent_start: sessionId=${sid}`);
      return [{ type: "agent_status", sessionId: sid, status: "working" }];
    }
    if (input?.type === "agent_settled" || input?.type === "agent_end") {
      console.log(`[RpcBridge] ${input.type}: sessionId=${sid}`);
      return [{ type: "agent_status", sessionId: sid, status: "idle" }];
    }

    if (input?.type === "message_start") {
      const message = input.message;
      if (message?.role !== "assistant") return [];
      const timestamp = typeof message?.timestamp === "number" ? message.timestamp : Date.now();
      const messageId = `assistant-${timestamp}`;
      this.activeAssistantMessageId = messageId;
      this.activeAssistantTimestamp = timestamp;
      return [{ type: "message_start", sessionId: sid, messageId, role: "assistant", timestamp }];
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
      // text_start/end, thinking_start/end, and toolcall_start/delta are
      // transport-level boundaries. They do not represent a user-visible
      // message, so rendering them produces the noisy MESSAGE_UPDATE rows.
      return [];
    }

    if (input?.type === "message_end") {
      const message = input.message;
      if (message?.role !== "assistant") return [];
      const timestamp = typeof message?.timestamp === "number"
        ? message.timestamp
        : (this.activeAssistantTimestamp ?? Date.now());
      const messageId = this.activeAssistantMessageId ?? `assistant-${timestamp}`;
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
        timestamp,
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

    // Forward knowledge_base_context custom messages so the frontend can
    // display KB retrieval results alongside the conversation.
    if (input?.type === "message_end" && input.message?.role === "custom" && input.message?.customType === "knowledge_base_context") {
      console.log(`[RpcBridge] knowledge_base_context: sessionId=${sid} display=${input.message.display}`);
      return [{ type: "raw", sessionId: sid, data: input }];
    }
    if (input?.role === "custom" && input?.customType === "knowledge_base_context") {
      console.log(`[RpcBridge] knowledge_base_context (standalone): sessionId=${sid}`);
      return [{ type: "raw", sessionId: sid, data: input }];
    }

    // `turn_*`, queue updates and compaction notifications are
    // state-machine details. The UI already receives their meaningful effects
    // through text, tool, and agent_status events, so omit them from the chat
    // transcript instead of exposing an internal event timeline.
    return [];
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
    const piCommand = this.toPiCommand(command as any);
    console.log(`[RpcBridge] send: type=${(piCommand as any)?.type} sessionId=${this.sessionId} msgLen=${String((piCommand as any)?.message ?? "").length}`);
    try {
      this.proc.stdin.write(JSON.stringify(piCommand) + "\n");
      console.log(`[RpcBridge] write completed`);
    } catch (err: any) {
      console.error(`[RpcBridge] write failed: ${err.message}`);
    }
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
