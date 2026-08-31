import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { wsClient } from "../../src/api/ws.js";
import { useAgentStore } from "../../src/stores/agent.js";

describe("agent model selection", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
  });

  it("updates the default and switches the active session", async () => {
    const json = (body: unknown) => new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        return json({
          provider: "openai",
          model: "qwen3.7-plus",
          models: [{ id: "qwen3.7-plus", provider: "openai", label: "qwen3.7-plus" }],
        });
      }
      return json([]);
    }));
    const send = vi.spyOn(wsClient, "send").mockImplementation(() => true);
    const agent = useAgentStore();

    await agent.switchModel("qwen3.7-plus", "session-1");

    expect(agent.currentModel).toBe("qwen3.7-plus");
    expect(send).toHaveBeenCalledWith({
      type: "switchModel",
      sessionId: "session-1",
      model: "qwen3.7-plus",
    });
  });

  it("includes the selected model in every prompt", () => {
    const send = vi.spyOn(wsClient, "send").mockImplementation(() => true);
    const agent = useAgentStore();
    agent.currentModel = "qwen3.7-plus";

    agent.send("session-1", "识别图片");

    expect(send).toHaveBeenCalledWith({
      type: "send",
      sessionId: "session-1",
      clientMessageId: expect.any(String),
      content: "识别图片",
      model: "qwen3.7-plus",
    });
  });
});
