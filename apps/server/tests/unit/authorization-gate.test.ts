import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolCallEvent } from "@earendil-works/pi-coding-agent";
import authorizationGate from "../../src/agent/extensions/authorization-gate.js";

function fakePi() {
  let handler: ((event: ToolCallEvent, ctx: { signal?: AbortSignal }) => Promise<unknown>) | undefined;
  return {
    on: vi.fn((_event: string, registered: typeof handler) => { handler = registered; }),
    invoke: async (event: ToolCallEvent, signal?: AbortSignal) => handler?.(event, { signal }),
  };
}

function toolCall(toolName: string): ToolCallEvent {
  return {
    type: "tool_call",
    toolCallId: `call-${toolName}`,
    toolName,
    input: toolName === "bash" ? { command: "pwd" } : { path: "src/index.ts" },
  } as ToolCallEvent;
}

describe("core tool authorization extension", () => {
  beforeEach(() => {
    process.env.PI_WEB_UI_AUTHORIZATION_ENDPOINT = "http://127.0.0.1:8080/api/internal/authorization";
    process.env.PI_WEB_UI_AUTHORIZATION_TOKEN = "session-token";
    process.env.PI_WEB_UI_AUTHORIZATION_SESSION_ID = "session-1";
  });

  afterEach(() => {
    delete process.env.PI_WEB_UI_AUTHORIZATION_ENDPOINT;
    delete process.env.PI_WEB_UI_AUTHORIZATION_TOKEN;
    delete process.env.PI_WEB_UI_AUTHORIZATION_SESSION_ID;
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("checks every built-in tool that can execute or access local files", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ approved: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const pi = fakePi();
    authorizationGate(pi as never);

    for (const name of ["bash", "read", "write", "edit", "grep", "find", "ls"]) {
      await pi.invoke(toolCall(name));
    }

    expect(pi.on).toHaveBeenCalledWith("tool_call", expect.any(Function));
    expect(fetchMock).toHaveBeenCalledTimes(7);
    const request = fetchMock.mock.calls[0]![1] ?? {};
    expect(request).toMatchObject({
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-pi-authorization-token": "session-token",
      },
    });
    expect(JSON.parse(String(request.body))).toMatchObject({
      toolCallId: "call-bash",
      toolName: "bash",
      input: { command: "pwd" },
    });
  });

  it("lets approved calls continue and blocks denied calls", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ approved: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ approved: false, reason: "拒绝" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const pi = fakePi();
    authorizationGate(pi as never);

    expect(await pi.invoke(toolCall("read"))).toBeUndefined();
    expect(await pi.invoke(toolCall("write"))).toEqual({ block: true, reason: "拒绝" });
  });

  it("passes unknown tools through without a host request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const pi = fakePi();
    authorizationGate(pi as never);

    expect(await pi.invoke(toolCall("custom_plugin_tool"))).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed on abort, invalid responses, and missing host credentials", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const pi = fakePi();
    authorizationGate(pi as never);
    const controller = new AbortController();
    controller.abort();

    expect(await pi.invoke(toolCall("bash"), controller.signal)).toMatchObject({ block: true });
    expect(await pi.invoke(toolCall("read"))).toMatchObject({ block: true });

    delete process.env.PI_WEB_UI_AUTHORIZATION_TOKEN;
    const missingCredentialsPi = fakePi();
    authorizationGate(missingCredentialsPi as never);
    expect(await missingCredentialsPi.invoke(toolCall("edit"))).toMatchObject({ block: true });
  });

  it("fails closed when the host request exceeds its deadline", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }));
    vi.stubGlobal("fetch", fetchMock);
    const pi = fakePi();
    authorizationGate(pi as never);

    const pending = pi.invoke(toolCall("bash"));
    await vi.advanceTimersByTimeAsync(126_000);
    await expect(pending).resolves.toMatchObject({ block: true, reason: expect.stringContaining("超时") });
  });
});
