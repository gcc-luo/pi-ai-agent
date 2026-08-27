import { describe, expect, it } from "vitest";
import { summarizeTokenUsage, type UsageMessage } from "./token-usage.js";
import { mergeChatMessageSources } from "./chat-run-presentation.js";

const user = (id: string, createdAt: number): UsageMessage & { createdAt: number } => ({
  id, role: "user", createdAt, metadata: null, parts: [{ kind: "text", text: id }],
});
const assistant = (id: string, createdAt: number, usage: unknown): UsageMessage & { createdAt: number } => ({
  id, role: "assistant", createdAt, metadata: { usage, model: "test-model" }, parts: [],
});

describe("token usage accounting", () => {
  it("uses message IDs when optional legacy timestamps are absent", () => {
    const result = summarizeTokenUsage([
      { id: "a1", role: "assistant", metadata: { usage: { input: 10, output: 1 } } },
      { id: "a2", role: "assistant", metadata: { usage: { input: 20, output: 2 } } },
    ]);
    expect(result.current).toMatchObject({ prompt: 30, output: 3, modelCalls: 2 });
  });
  it("separates the latest user request from lifetime usage and includes cache in input totals", () => {
    const result = summarizeTokenUsage([
      user("u1", 1), assistant("a1", 2, { input: 80000, output: 1000 }),
      user("u2", 3), assistant("a2", 4, { input: 2000, output: 100, cacheRead: 8000, cacheWrite: 500 }),
      assistant("a3", 5, { input: 3000, output: 200, cacheRead: 9000, cacheWrite: 0 }),
    ]);
    expect(result.session).toMatchObject({ input: 85000, prompt: 102500, output: 1300, modelCalls: 3 });
    expect(result.current).toMatchObject({ input: 5000, prompt: 22500, output: 300, cacheRead: 17000, cacheWrite: 500, modelCalls: 2 });
    expect(result.calls.map((call) => call.id)).toEqual(["a2", "a3"]);
    expect(result.latest?.prompt).toBe(12000);
  });

  it("does not double count persisted copies, replayed IDs, or duplicate tool IDs", () => {
    const a = assistant("a1", 2, { input: 100, output: 10 });
    a.parts = [{ kind: "tool_call", toolCallId: "t1", name: "read", args: {}, status: "complete" }];
    a.metadata!.toolCalls = [{ toolCallId: "t1", name: "read" }];
    const merged = mergeChatMessageSources([user("u1", 1), { ...a, id: "db-a1" }], [a, a]);
    const result = summarizeTokenUsage([...merged, ...merged]);
    expect(result.session).toMatchObject({ input: 100, output: 10, modelCalls: 1, toolCalls: 1 });
    expect(result.current.toolCalls).toBe(1);
  });

  it("keeps in-flight calls when an older history snapshot arrives", () => {
    const old = assistant("old", 2, { input: 10, output: 1 });
    const live = assistant("new", 4, { input: 20, output: 2 });
    const result = summarizeTokenUsage(mergeChatMessageSources(
      [user("u1", 1), old], [user("u2", 3), live],
    ));
    expect(result.session.input).toBe(30);
    expect(result.current.input).toBe(20);
  });

  it("resets the current request when a new user message has no response yet", () => {
    const result = summarizeTokenUsage([
      user("u1", 1), assistant("a1", 2, { input: 100, output: 10 }), user("u2", 3),
    ]);
    expect(result.current.modelCalls).toBe(0);
    expect(result.current.prompt).toBe(0);
    expect(result.session.prompt).toBe(100);
    expect(result.calls).toEqual([]);
  });

  it("distinguishes missing cache telemetry from a reported zero and rejects invalid counters", () => {
    const result = summarizeTokenUsage([
      user("u1", 1), assistant("missing", 2, undefined),
      assistant("bad", 3, { input: -2, output: "20", cacheRead: NaN }),
      assistant("zero", 4, { input: 5, output: Infinity, cacheWrite: 0 }),
    ]);
    expect(result.current).toMatchObject({ input: 5, output: 0, cacheRead: null, cacheWrite: 0, modelCalls: 2 });
    expect(result.calls).toHaveLength(2);
  });
});
