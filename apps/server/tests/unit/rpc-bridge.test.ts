import { describe, it, expect, vi } from "vitest";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import { RpcBridge } from "../../src/agent/rpc-bridge.js";

function makeProc() {
  const proc: any = new EventEmitter();
  proc.stdin = new PassThrough();
  proc.stdout = new PassThrough();
  return proc;
}

describe("RpcBridge", () => {
  it("parses a complete JSON line from stdout and emits an event", () => {
    const proc = makeProc();
    const bridge = new RpcBridge(proc, "s1");
    const onEvent = vi.fn();
    bridge.onEvent(onEvent);

    proc.stdout.write(JSON.stringify({
      type: "message_start",
      message: { role: "assistant", timestamp: 222 },
    }) + "\n");
    proc.stdout.write(JSON.stringify({
      type: "message_update",
      message: { role: "assistant", timestamp: 222 },
      assistantMessageEvent: { type: "text_delta", delta: "hi" },
    }) + "\n");
    expect(onEvent).toHaveBeenCalledWith({
      type: "message_delta",
      sessionId: "s1",
      messageId: "assistant-222",
      delta: "hi",
    });
  });

  it("buffers partial lines across chunks", () => {
    const proc = makeProc();
    const bridge = new RpcBridge(proc, "s1");
    const onEvent = vi.fn();
    bridge.onEvent(onEvent);

    proc.stdout.write(JSON.stringify({ type: "agent_start" }).slice(0, 5));
    proc.stdout.write(JSON.stringify({ type: "agent_start" }).slice(5) + "\n");
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it("writes commands to stdin as JSON lines", () => {
    const proc = makeProc();
    const bridge = new RpcBridge(proc, "s1");
    const writeSpy = vi.spyOn(proc.stdin, "write");
    bridge.send({ type: "send", sessionId: "s1", content: "hi" });
    expect(writeSpy).toHaveBeenCalledWith(JSON.stringify({ type: "prompt", message: "hi" }) + "\n");
  });

  it("converts web image attachments to Pi RPC image content", () => {
    const proc = makeProc();
    const bridge = new RpcBridge(proc, "s1");
    const writeSpy = vi.spyOn(proc.stdin, "write");

    bridge.send({
      type: "send",
      sessionId: "s1",
      content: "describe this image",
      images: [{ name: "screen.png", mediaType: "image/png", data: "aGVsbG8=" }],
    });

    expect(writeSpy).toHaveBeenCalledWith(JSON.stringify({
      type: "prompt",
      message: "describe this image",
      images: [{ type: "image", mimeType: "image/png", data: "aGVsbG8=" }],
    }) + "\n");
  });

  it("ignores malformed JSON", () => {
    const proc = makeProc();
    const bridge = new RpcBridge(proc, "s1");
    const onEvent = vi.fn();
    bridge.onEvent(onEvent);
    proc.stdout.write("not json\n");
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("maps pi assistant stream events to web server events", () => {
    const proc = makeProc();
    const bridge = new RpcBridge(proc, "s1");
    const onEvent = vi.fn();
    bridge.onEvent(onEvent);

    proc.stdout.write(JSON.stringify({
      type: "message_start",
      message: { role: "assistant", content: [], timestamp: 111 },
    }) + "\n");
    proc.stdout.write(JSON.stringify({
      type: "message_update",
      message: { role: "assistant", content: [{ type: "text", text: "你" }], timestamp: 111 },
      assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "你" },
    }) + "\n");
    proc.stdout.write(JSON.stringify({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "你好" }], timestamp: 111 },
    }) + "\n");

    expect(onEvent).toHaveBeenNthCalledWith(1, {
      type: "message_start",
      sessionId: "s1",
      messageId: "assistant-111",
      role: "assistant",
      timestamp: 111,
    });
    expect(onEvent).toHaveBeenNthCalledWith(2, {
      type: "message_delta",
      sessionId: "s1",
      messageId: "assistant-111",
      delta: "你",
    });
    expect(onEvent).toHaveBeenNthCalledWith(3, {
      type: "message_end",
      sessionId: "s1",
      messageId: "assistant-111",
      content: "你好",
      metadata: expect.any(Object),
      timestamp: 111,
    });
    expect(onEvent.mock.calls[2][0].metadata.messageParts).toEqual([
      { type: "text", text: "你好" },
    ]);
  });

  it("preserves thinking and tool-call blocks from the completed Pi message", () => {
    const proc = makeProc();
    const bridge = new RpcBridge(proc, "s1");
    const onEvent = vi.fn();
    bridge.onEvent(onEvent);

    proc.stdout.write(JSON.stringify({
      type: "message_start",
      message: { role: "assistant", timestamp: 444 },
    }) + "\n");
    proc.stdout.write(JSON.stringify({
      type: "message_end",
      message: {
        role: "assistant",
        timestamp: 444,
        content: [
          { type: "thinking", thinking: "I need a tool." },
          { type: "toolCall", id: "call-2", name: "read_file", arguments: { path: "README.md" } },
        ],
      },
    }) + "\n");

    expect(onEvent.mock.calls[1][0].metadata.messageParts).toEqual([
      { type: "thinking", thinking: "I need a tool." },
      {
        type: "toolCall",
        id: "call-2",
        name: "read_file",
        arguments: { path: "README.md" },
        status: "running",
      },
    ]);
  });

  it("forwards tool calls and their execution result", () => {
    const proc = makeProc();
    const bridge = new RpcBridge(proc, "s1");
    const onEvent = vi.fn();
    bridge.onEvent(onEvent);

    proc.stdout.write(JSON.stringify({
      type: "message_start",
      message: { role: "assistant", timestamp: 333 },
    }) + "\n");
    proc.stdout.write(JSON.stringify({
      type: "message_update",
      assistantMessageEvent: {
        type: "toolcall_end",
        toolCall: { id: "call-1", name: "read_file", arguments: { path: "README.md" } },
      },
    }) + "\n");
    proc.stdout.write(JSON.stringify({
      type: "tool_execution_end",
      toolCallId: "call-1",
      result: { content: "# Pi Web UI" },
    }) + "\n");

    expect(onEvent).toHaveBeenNthCalledWith(2, {
      type: "tool_call",
      sessionId: "s1",
      messageId: "assistant-333",
      toolCallId: "call-1",
      name: "read_file",
      args: { path: "README.md" },
    });
    expect(onEvent).toHaveBeenNthCalledWith(3, {
      type: "tool_result",
      sessionId: "s1",
      toolCallId: "call-1",
      result: { content: "# Pi Web UI" },
    });
  });

  it("maps pi response failures to web error events", () => {
    const proc = makeProc();
    const bridge = new RpcBridge(proc, "s1");
    const onEvent = vi.fn();
    bridge.onEvent(onEvent);

    proc.stdout.write(JSON.stringify({ type: "response", command: "prompt", success: false, error: "No model selected" }) + "\n");

    expect(onEvent).toHaveBeenCalledWith({
      type: "error",
      sessionId: "s1",
      code: "pi_prompt_failed",
      message: "No model selected",
    });
  });

  it("maps provider error messages instead of emitting a blank assistant reply", () => {
    const proc = makeProc();
    const bridge = new RpcBridge(proc, "s1");
    const onEvent = vi.fn();
    bridge.onEvent(onEvent);

    proc.stdout.write(JSON.stringify({
      type: "message_start",
      message: { role: "assistant", timestamp: 777 },
    }) + "\n");
    proc.stdout.write(JSON.stringify({
      type: "message_end",
      message: {
        role: "assistant",
        content: [],
        stopReason: "error",
        errorMessage: "HTTP Error: 400",
        timestamp: 777,
      },
    }) + "\n");

    expect(onEvent).toHaveBeenNthCalledWith(2, {
      type: "error",
      sessionId: "s1",
      code: "pi_model_error",
      message: "HTTP Error: 400",
    });
    expect(onEvent.mock.calls.some(([event]) => event.type === "message_end")).toBe(false);
  });

  it("drops structural message updates and lifecycle events from the transcript", () => {
    const proc = makeProc();
    const bridge = new RpcBridge(proc, "s1");
    const onEvent = vi.fn();
    bridge.onEvent(onEvent);

    proc.stdout.write(JSON.stringify({ type: "agent_start" }) + "\n");
    proc.stdout.write(JSON.stringify({
      type: "message_start", message: { role: "assistant", timestamp: 555 },
    }) + "\n");
    proc.stdout.write(JSON.stringify({
      type: "message_update", assistantMessageEvent: { type: "text_start", contentIndex: 0 },
    }) + "\n");
    proc.stdout.write(JSON.stringify({ type: "turn_end" }) + "\n");
    proc.stdout.write(JSON.stringify({ type: "agent_settled" }) + "\n");

    expect(onEvent.mock.calls.map(([event]) => event)).toEqual([
      { type: "agent_status", sessionId: "s1", status: "working" },
      { type: "message_start", sessionId: "s1", messageId: "assistant-555", role: "assistant", timestamp: 555 },
      expect.objectContaining({
        type: "agent_status",
        sessionId: "s1",
        status: "idle",
        durationMs: expect.any(Number),
      }),
    ]);
  });

  it("exposes automatic compaction progress and token reduction", () => {
    const proc = makeProc();
    const bridge = new RpcBridge(proc, "s1");
    const onEvent = vi.fn();
    bridge.onEvent(onEvent);

    proc.stdout.write(JSON.stringify({
      type: "compaction_start",
      reason: "threshold",
      willRetry: false,
    }) + "\n");
    proc.stdout.write(JSON.stringify({
      type: "compaction_end",
      reason: "threshold",
      result: { tokensBefore: 118000, estimatedTokensAfter: 24000 },
      willRetry: false,
    }) + "\n");

    expect(onEvent.mock.calls.map(([event]) => event)).toEqual([
      { type: "agent_status", sessionId: "s1", status: "working" },
      {
        type: "context_compaction",
        sessionId: "s1",
        phase: "started",
        reason: "threshold",
        willRetry: false,
      },
      {
        type: "context_compaction",
        sessionId: "s1",
        phase: "completed",
        reason: "threshold",
        tokensBefore: 118000,
        estimatedTokensAfter: 24000,
        willRetry: false,
        error: undefined,
      },
    ]);
  });

  it("settles manual compaction on both success and rejected RPC responses", () => {
    for (const success of [true, false]) {
      const proc = makeProc();
      const bridge = new RpcBridge(proc, "s1");
      const onEvent = vi.fn();
      bridge.onEvent(onEvent);
      proc.stdout.write(JSON.stringify({ type: "response", command: "compact", success, error: success ? undefined : "nothing to compact" }) + "\n");
      const events = onEvent.mock.calls.map(([event]) => event);
      expect(events.at(-1)).toEqual({ type: "agent_status", sessionId: "s1", status: "idle" });
      if (!success) expect(events).toContainEqual(expect.objectContaining({ type: "context_compaction", phase: "failed", reason: "manual" }));
    }
  });

  it("keeps the run working through overflow compaction until agent_settled", () => {
    const proc = makeProc();
    const bridge = new RpcBridge(proc, "s1");
    const onEvent = vi.fn();
    bridge.onEvent(onEvent);

    proc.stdout.write(JSON.stringify({ type: "agent_end" }) + "\n");
    proc.stdout.write(JSON.stringify({
      type: "compaction_start", reason: "overflow", willRetry: true,
    }) + "\n");
    proc.stdout.write(JSON.stringify({
      type: "compaction_end",
      reason: "overflow",
      result: { tokensBefore: 128000, estimatedTokensAfter: 20000 },
      willRetry: true,
    }) + "\n");
    proc.stdout.write(JSON.stringify({ type: "agent_settled" }) + "\n");

    const statuses = onEvent.mock.calls
      .map(([event]) => event)
      .filter((event) => event.type === "agent_status");
    expect(statuses).toEqual([
      { type: "agent_status", sessionId: "s1", status: "working" },
      { type: "agent_status", sessionId: "s1", status: "idle" },
    ]);
  });

  it("maps model switch commands to pi set_model commands", () => {
    const proc = makeProc();
    const bridge = new RpcBridge(proc, "s1");
    const writeSpy = vi.spyOn(proc.stdin, "write");

    bridge.send({ type: "switchModel", sessionId: "s1", provider: "openai", model: "glm-4.7" });

    expect(writeSpy).toHaveBeenCalledWith(JSON.stringify({ type: "set_model", provider: "openai", modelId: "glm-4.7" }) + "\n");
  });
});
