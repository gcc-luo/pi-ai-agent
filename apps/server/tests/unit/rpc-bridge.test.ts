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
    expect(writeSpy).toHaveBeenCalledWith(JSON.stringify({ type: "send", sessionId: "s1", content: "hi" }) + "\n");
  });

  it("ignores malformed JSON", () => {
    const proc = makeProc();
    const bridge = new RpcBridge(proc, "s1");
    const onEvent = vi.fn();
    bridge.onEvent(onEvent);
    proc.stdout.write("not json\n");
    expect(onEvent).not.toHaveBeenCalled();
  });
});
