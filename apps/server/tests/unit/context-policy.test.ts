import { describe, expect, it, vi } from "vitest";
import contextPolicy from "../../src/agent/extensions/context-policy.js";

describe("stable context policy", () => {
  it("adds artifact rules to the system prompt without adding chat messages or accumulating copies", async () => {
    const on = vi.fn();
    contextPolicy({ on } as any);
    const hook = on.mock.calls.find(([name]) => name === "before_agent_start")![1];
    const original = { systemPrompt: "base project rules", prompt: "hello" };
    const first = await hook(original, {});
    const second = await hook(original, {});
    const repeated = await hook({ ...original, systemPrompt: first.systemPrompt }, {});
    expect(first.systemPrompt).toContain("base project rules");
    expect(first.systemPrompt).toContain("<artifacts>");
    expect(first.systemPrompt).toContain("mimeType");
    expect(first.message).toBeUndefined();
    expect(second).toEqual(first);
    expect(repeated.systemPrompt).toBe(first.systemPrompt);
    expect(original.prompt).toBe("hello");
  });
});
