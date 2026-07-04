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

    proc.stdout.write(JSON.stringify({ type: "message_delta", sessionId: "s1", messageId: "m1", delta: "hi" }) + "\n");
    expect(onEvent).toHaveBeenCalledWith({
      type: "message_delta",
      sessionId: "s1",
      messageId: "m1",
      delta: "hi",
    });
  });

  it("buffers partial lines across chunks", () => {
    const proc = makeProc();
    const bridge = new RpcBridge(proc, "s1");
    const onEvent = vi.fn();
    bridge.onEvent(onEvent);

    const line = JSON.stringify({ type: "message_delta", sessionId: "s1", messageId: "m1", delta: "hello" });
    proc.stdout.write(line.slice(0, 10));
    proc.stdout.write(line.slice(10) + "\n");
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it("writes commands to stdin as JSON lines", () => {
    const proc = makeProc();
    const bridge = new RpcBridge(proc, "s1");
    const writeSpy = vi.spyOn(proc.stdin, "write");
    bridge.send({ type: "send", sessionId: "s1", content: "hi" });
    expect(writeSpy).toHaveBeenCalledWith(JSON.stringify({ type: "prompt", message: "hi" }) + "\n");
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

  it("maps model switch commands to pi set_model commands", () => {
    const proc = makeProc();
    const bridge = new RpcBridge(proc, "s1");
    const writeSpy = vi.spyOn(proc.stdin, "write");

    bridge.send({ type: "switchModel", sessionId: "s1", provider: "openai", model: "glm-4.7" });

    expect(writeSpy).toHaveBeenCalledWith(JSON.stringify({ type: "set_model", provider: "openai", modelId: "glm-4.7" }) + "\n");
  });
});
