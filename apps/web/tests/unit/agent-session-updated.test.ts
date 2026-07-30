import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useSessionStore } from "../../src/stores/session.js";
import { useAgentStore } from "../../src/stores/agent.js";

describe("agent store session_updated event", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
  });

  const seedSession = (id: string, title: string | null) => ({
    id, projectId: "p1", title, parentId: null, expertId: null,
    status: "active" as const, createdAt: 0, updatedAt: 0, lastActiveAt: null, deletedAt: null,
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

  it("clears an empty assistant placeholder when the model request fails", () => {
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

    expect(agent.isSessionBusy("s1")).toBe(false);
    expect(agent.messagesFor("s1")).toEqual([]);
    expect(agent.errors).toContainEqual({
      sessionId: "s1",
      code: "pi_model_error",
      message: "HTTP Error: 400",
    });
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
});
