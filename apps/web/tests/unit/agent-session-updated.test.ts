import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useSessionStore } from "../../src/stores/session.js";
import { partsFromPersisted, useAgentStore } from "../../src/stores/agent.js";
import { wsClient } from "../../src/api/ws.js";

describe("agent store session_updated event", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
  });

  const seedSession = (id: string, title: string | null) => ({
    id, projectId: "p1", title, parentId: null, expertId: null,
    selectedPluginIds: [], browserEnabled: false,
    status: "active" as const, createdAt: 0, updatedAt: 0, lastActiveAt: null, deletedAt: null,
  });

  it("registers the streaming event listener only once", () => {
    const agent = useAgentStore();
    const onEvent = vi.spyOn(wsClient, "onEvent");
    vi.spyOn(agent, "loadConfig").mockResolvedValue();

    agent.init();
    agent.init();

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(agent.loadConfig).toHaveBeenCalledTimes(1);
  });

  it("requests compaction without adding a user message and guards concurrent work", () => {
    const agent = useAgentStore();
    const send = vi.spyOn(wsClient, "send").mockReturnValue(true);
    expect(agent.compact("s1")).toBe(true);
    expect(send).toHaveBeenCalledWith({ type: "compact", sessionId: "s1" });
    expect(agent.messagesFor("s1")).toEqual([]);
    expect(agent.isSessionBusy("s1")).toBe(true);
    expect(agent.compact("s1")).toBe(false);
    agent.handle({ type: "agent_status", sessionId: "s1", status: "idle" });
    send.mockReturnValue(false);
    expect(agent.compact("s1")).toBe(false);
    expect(agent.isSessionBusy("s1")).toBe(false);
  });

  it("restores a completion and its usage when replay no longer includes message_start", () => {
    const agent = useAgentStore();
    const end = { type: "message_end" as const, sessionId: "s1", messageId: "assistant-42", timestamp: 42, content: "done", metadata: { usage: { input: 100, output: 10 } } };
    agent.handle(end);
    agent.handle(end);
    expect(agent.messagesFor("s1")).toHaveLength(1);
    expect(agent.messagesFor("s1")[0]).toMatchObject({ createdAt: 42, status: "complete", metadata: end.metadata });
  });

  it("does not turn a compaction failure into a failed user prompt", () => {
    const agent = useAgentStore();
    vi.spyOn(wsClient, "send").mockReturnValue(true);
    agent.appendUser("s1", "previous request");
    agent.compact("s1");
    agent.handle({ type: "error", sessionId: "s1", code: "project_workdir_missing", message: "missing" });
    expect(agent.messagesFor("s1")[0]?.status).toBe("complete");
    expect(agent.isSessionBusy("s1")).toBe(false);
    expect(agent.compactionFor("s1")?.phase).toBe("failed");
  });

  it("replaces the matching session in the list and keeps current in sync", async () => {
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
      status, headers: { "Content-Type": "application/json" },
    });
    const fetchMock = vi.fn(async (url: string) => {
      const path = String(url).replace(/^.*\/api/, "");
      if (path === "/projects/p1/sessions") return json([seedSession("s1", null)]);
      if (path === "/sessions/s1") return json(seedSession("s1", null));
      if (path === "/sessions/s1/messages") return json([]);
      return json({}, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    const sessionStore = useSessionStore();
    await sessionStore.loadForProject("p1");
    await sessionStore.open("s1");
    expect(sessionStore.sessions[0]!.title).toBeNull();
    expect(sessionStore.current?.id).toBe("s1");

    const agent = useAgentStore();
    agent.handle({ type: "session_updated", session: seedSession("s1", "first message") });

    expect(sessionStore.sessions[0]!.title).toBe("first message");
    expect(sessionStore.current?.title).toBe("first message");
  });

  it("ignores session_updated for sessions not in the list", () => {
    const sessionStore = useSessionStore();
    sessionStore.sessions = [];
    sessionStore.current = null;

    const agent = useAgentStore();
    agent.handle({ type: "session_updated", session: seedSession("other", "x") });

    expect(sessionStore.sessions).toEqual([]);
    expect(sessionStore.current).toBeNull();
  });

  it("keeps each session busy until its own final agent lifecycle event", () => {
    const agent = useAgentStore();

    agent.handle({ type: "agent_status", sessionId: "s1", status: "working" });
    agent.handle({ type: "agent_status", sessionId: "s2", status: "working" });
    agent.handle({
      type: "message_start", sessionId: "s1", messageId: "m1", role: "assistant",
    });
    agent.handle({
      type: "message_end", sessionId: "s1", messageId: "m1", content: "I will call a tool.",
    });

    // message_end completes only this model turn, not the complete agent run.
    expect(agent.isSessionBusy("s1")).toBe(true);
    expect(agent.isSessionBusy("s2")).toBe(true);

    agent.handle({ type: "agent_status", sessionId: "s1", status: "idle" });
    expect(agent.isSessionBusy("s1")).toBe(false);
    expect(agent.isSessionBusy("s2")).toBe(true);
  });

  it("tracks a live run start and attaches its final duration to the last assistant message", () => {
    const agent = useAgentStore();

    agent.handle({ type: "agent_status", sessionId: "s1", status: "working", startedAt: 1_000 });
    expect(agent.runStartedAtFor("s1")).toBe(1_000);

    agent.handle({
      type: "message_start", sessionId: "s1", messageId: "m1", role: "assistant",
    });
    agent.handle({
      type: "message_end", sessionId: "s1", messageId: "m1", content: "done",
    });
    agent.handle({
      type: "agent_status", sessionId: "s1", status: "idle", durationMs: 74_000,
    });

    expect(agent.runStartedAtFor("s1")).toBeNull();
    expect(agent.messagesFor("s1")[0]?.metadata).toMatchObject({ durationMs: 74_000 });
  });

  it("restores the original run start after session status replay", () => {
    const agent = useAgentStore();

    agent.handle({ type: "agent_status", sessionId: "s1", status: "working", startedAt: 10_000 });
    agent.handle({ type: "agent_status", sessionId: "s1", status: "idle" });
    agent.handle({ type: "agent_status", sessionId: "s1", status: "working", startedAt: 10_000 });

    expect(agent.runStartedAtFor("s1")).toBe(10_000);
  });

  it("ignores a repeated message_start boundary for the same assistant message", () => {
    const agent = useAgentStore();
    const start = {
      type: "message_start" as const,
      sessionId: "s1",
      messageId: "assistant-1000",
      role: "assistant" as const,
      timestamp: 1_000,
    };

    agent.handle(start);
    agent.handle(start);

    expect(agent.messagesFor("s1")).toHaveLength(1);
  });

  it("keeps an interrupted outcome until the next run starts", () => {
    const agent = useAgentStore();
    vi.spyOn(wsClient, "send").mockImplementation(() => true);

    agent.handle({ type: "agent_status", sessionId: "s1", status: "working" });
    agent.handle({
      type: "error", sessionId: "s1", code: "pi_model_error", message: "Internal error",
    });
    agent.interrupt("s1");
    agent.handle({ type: "agent_status", sessionId: "s1", status: "idle", durationMs: 3_000 });
    expect(agent.runOutcomeFor("s1")).toBe("interrupted");
    expect(agent.errors).toEqual([]);

    agent.handle({ type: "agent_status", sessionId: "s1", status: "working" });
    expect(agent.runOutcomeFor("s1")).toBeNull();
  });

  it("does not mark a normally suspended session as a failed run", () => {
    const agent = useAgentStore();

    agent.handle({ type: "agent_status", sessionId: "s1", status: "working" });
    agent.handle({ type: "agent_status", sessionId: "s1", status: "idle" });
    agent.handle({ type: "session_status", sessionId: "s1", status: "suspended" });

    expect(agent.isSessionBusy("s1")).toBe(false);
    expect(agent.runOutcomeFor("s1")).toBeNull();
  });

  it("marks a process crash as failed only when it interrupts an active run", () => {
    const agent = useAgentStore();

    agent.handle({ type: "agent_status", sessionId: "s1", status: "working" });
    agent.handle({ type: "agent_status", sessionId: "s1", status: "idle" });
    agent.handle({ type: "session_status", sessionId: "s1", status: "crashed" });
    expect(agent.runOutcomeFor("s1")).toBe("failed");

    agent.handle({ type: "agent_status", sessionId: "s2", status: "idle" });
    agent.handle({ type: "session_status", sessionId: "s2", status: "crashed" });
    expect(agent.runOutcomeFor("s2")).toBeNull();
  });

  it("keeps the run busy through transient model errors and fails it only when settled", () => {
    const agent = useAgentStore();

    agent.handle({ type: "agent_status", sessionId: "s1", status: "working" });
    agent.handle({
      type: "message_start", sessionId: "s1", messageId: "m1", role: "assistant",
    });
    agent.handle({
      type: "error",
      sessionId: "s1",
      code: "pi_model_error",
      message: "HTTP Error: 400",
    });

    expect(agent.isSessionBusy("s1")).toBe(true);
    expect(agent.messagesFor("s1")).toEqual([]);
    expect(agent.errors).toEqual([]);

    agent.handle({ type: "agent_status", sessionId: "s1", status: "idle" });

    expect(agent.isSessionBusy("s1")).toBe(false);
    expect(agent.errors).toContainEqual({
      sessionId: "s1",
      code: "pi_model_error",
      message: "HTTP Error: 400",
    });
  });

  it("clears a transient model error when a retry succeeds", () => {
    const agent = useAgentStore();

    agent.handle({ type: "agent_status", sessionId: "s1", status: "working" });
    agent.handle({
      type: "error", sessionId: "s1", code: "pi_model_error", message: "Internal error",
    });
    agent.handle({
      type: "message_start", sessionId: "s1", messageId: "m2", role: "assistant",
    });
    agent.handle({
      type: "message_end", sessionId: "s1", messageId: "m2", content: "你好！",
    });
    agent.handle({ type: "agent_status", sessionId: "s1", status: "idle" });

    expect(agent.isSessionBusy("s1")).toBe(false);
    expect(agent.errors).toEqual([]);
    expect(agent.runOutcomeFor("s1")).toBeNull();
  });

  it("tracks context compaction independently for each session", () => {
    const agent = useAgentStore();

    agent.handle({
      type: "context_compaction",
      sessionId: "s1",
      phase: "started",
      reason: "threshold",
    });
    agent.handle({
      type: "context_compaction",
      sessionId: "s2",
      phase: "completed",
      reason: "overflow",
      tokensBefore: 128000,
      estimatedTokensAfter: 22000,
      willRetry: true,
    });

    expect(agent.compactionFor("s1")).toMatchObject({
      phase: "started",
      reason: "threshold",
    });
    expect(agent.compactionFor("s2")).toMatchObject({
      phase: "completed",
      reason: "overflow",
      tokensBefore: 128000,
      estimatedTokensAfter: 22000,
      willRetry: true,
    });
  });

  it("requires an explicit UI response for sensitive plugin actions", () => {
    const agent = useAgentStore();
    const send = vi.spyOn(wsClient, "send").mockImplementation(() => true);
    agent.handle({
      type: "permission_request",
      sessionId: "s1",
      requestId: "request-1",
      pluginId: "computer-use",
      action: "click",
      reason: "will submit a form",
      expiresAt: Date.now() + 60_000,
    });

    expect(agent.pendingPermissions.s1).toMatchObject({ requestId: "request-1" });
    agent.respondToPermission("s1", "request-1", true);

    expect(agent.pendingPermissions.s1).toBeUndefined();
    expect(send).toHaveBeenCalledWith({
      type: "permission_response",
      sessionId: "s1",
      requestId: "request-1",
      approved: true,
    });
  });

  it("marks a prompt as failed when the socket is unavailable and allows retry", () => {
    const agent = useAgentStore();
    const send = vi.spyOn(wsClient, "send").mockImplementation(() => false);

    const messageId = agent.send("s1", "请继续", [{
      name: "shot.png",
      mediaType: "image/png",
      data: "abc",
    }]);

    expect(agent.isSessionBusy("s1")).toBe(false);
    expect(agent.messagesFor("s1")[0]).toMatchObject({ id: messageId, status: "error" });
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({
      type: "send",
      sessionId: "s1",
      clientMessageId: messageId,
    }));

    send.mockImplementation(() => true);
    expect(agent.retryUserMessage("s1", messageId)).toBe(true);
    expect(agent.isSessionBusy("s1")).toBe(true);
    expect(agent.messagesFor("s1")[0]).toMatchObject({ status: "complete" });
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({
      type: "send",
      sessionId: "s1",
      clientMessageId: messageId,
      content: "请继续",
      images: [{ name: "shot.png", mediaType: "image/png", data: "abc" }],
    }));
  });

  it("merges persisted tool results back into Pi message parts", () => {
    const parts = partsFromPersisted("", {
      messageParts: [{
        type: "toolCall",
        id: "call-1",
        name: "bash",
        arguments: { command: "pnpm dev" },
      }],
      toolCalls: [{
        toolCallId: "call-1",
        name: "bash",
        args: { command: "pnpm dev" },
        status: "complete",
        result: { isError: true, content: [{ type: "text", text: "Agent stopped" }] },
      }],
    });

    expect(parts).toEqual([
      expect.objectContaining({
        kind: "tool_call",
        toolCallId: "call-1",
        status: "complete",
        result: expect.objectContaining({ isError: true }),
      }),
    ]);
  });
});
