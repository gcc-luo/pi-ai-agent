import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import ChatPanel from "../../src/components/ChatPanel.vue";
import { useAgentStore } from "../../src/stores/agent.js";
import { useI18n } from "../../src/i18n/index.js";

describe("ChatPanel running input", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    useI18n().setLocale("zh");
    vi.restoreAllMocks();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json([])));
  });

  it("shows each run's usage at its header and cumulative usage above the composer without replay double counting", async () => {
    const agent = useAgentStore();
    agent.streams.s1 = [
      { id: "old-user", role: "user", createdAt: 1000, status: "complete", parts: [{ kind: "text", text: "old request" }], metadata: null },
      { id: "old-reply", role: "assistant", createdAt: 2000, status: "complete", parts: [{ kind: "text", text: "old answer" }], metadata: { durationMs: 30000, usage: { input: 10000, output: 1000 } } },
    ];
    agent.appendUser("s1", "hello");
    agent.handle({ type: "message_start", sessionId: "s1", messageId: "m1", role: "assistant", timestamp: Date.now() + 1 });
    const end = { type: "message_end" as const, sessionId: "s1", messageId: "m1", content: "done", metadata: { usage: { input: 2000, output: 200 } } };
    agent.handle(end);
    agent.handle(end);
    const wrapper = mount(ChatPanel, {
      props: { sessionId: "s1", projectId: "p1" },
      global: { stubs: { Input: true, SkillSelect: true, PluginSelect: true, ConnectorSelect: true, ChatExpertPicker: true, ChatKbPicker: true, ChatKbBanner: true, ImportSkillDialog: true, ConfirmDialog: true } },
    });
    await flushPromises();
    const total = wrapper.get(".composer-toolbar .token-usage-summary");
    expect(total.text()).toContain("会话累计");
    expect(total.get(".token-in").text()).toBe("↑12.0K");
    expect(total.get(".token-out").text()).toBe("↓1.2K");
    expect(total.text()).not.toContain("本次");
    const headers = wrapper.findAll(".activity-summary");
    expect(headers).toHaveLength(2);
    expect(headers[0]!.text()).toContain("已工作 30s");
    expect(headers[0]!.get(".token-in").text()).toBe("↑10.0K");
    expect(headers[1]!.get(".token-in").text()).toBe("↑2.0K");
    expect(headers[1]!.get(".token-out").text()).toBe("↓200");
    expect(headers[1]!.text()).toContain("1 次调用");
    agent.appendUser("s1", "next question");
    await flushPromises();
    expect(total.get(".token-in").text()).toBe("↑12.0K");
    expect(headers[0]!.get(".token-in").text()).toBe("↑10.0K");
    wrapper.unmount();
  });

  it("keeps the draft and requires the explicit stop button while busy", async () => {
    const agent = useAgentStore();
    agent.runStates.s1 = "working";
    agent.runStartedAt.s1 = Date.now();
    const interrupt = vi.spyOn(agent, "interrupt");
    const send = vi.spyOn(agent, "send");
    const wrapper = mount(ChatPanel, {
      props: { sessionId: "s1", projectId: "p1" },
      global: {
        stubs: {
          Input: {
            template: '<textarea :value="value" @input="$emit(\'update:value\', $event.target.value)" @keydown="$emit(\'keydown\', $event)"></textarea>',
            props: ["value"],
          },
          SkillSelect: true,
          PluginSelect: true,
          ChatExpertPicker: true,
          ChatKbPicker: true,
          ChatKbBanner: true,
          ImportSkillDialog: true,
          ConfirmDialog: true,
        },
      },
    });

    const textarea = wrapper.get("textarea");
    await textarea.setValue("下一条草稿");
    await textarea.trigger("keydown", { key: "Enter", shiftKey: false });

    expect(interrupt).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect((textarea.element as HTMLTextAreaElement).value).toBe("下一条草稿");
    expect(wrapper.get(".composer-busy-hint").text()).toContain("先编辑下一条消息");

    await wrapper.get(".send-btn.stop").trigger("click");
    expect(interrupt).toHaveBeenCalledWith("s1");
  });

  it("shows agent processing immediately before the first assistant message arrives", async () => {
    const agent = useAgentStore();
    agent.appendUser("s1", "写一首诗歌到 pptx 中");
    agent.runStates.s1 = "working";
    agent.runStartedAt.s1 = Date.now();

    const wrapper = mount(ChatPanel, {
      props: { sessionId: "s1", projectId: "p1" },
      global: {
        stubs: {
          Input: true,
          SkillSelect: true,
          PluginSelect: true,
          ChatExpertPicker: true,
          ChatKbPicker: true,
          ChatKbBanner: true,
          ImportSkillDialog: true,
          ConfirmDialog: true,
        },
      },
    });
    await wrapper.vm.$nextTick();

    expect(wrapper.get(".msg.assistant .agent-activity").text()).toContain("正在工作");
    expect(wrapper.find(".msg.assistant .msg-avatar-label").exists()).toBe(false);

    agent.handle({
      type: "message_start",
      sessionId: "s1",
      messageId: "assistant-real",
      role: "assistant",
      timestamp: Date.now(),
    });
    await wrapper.vm.$nextTick();

    expect(wrapper.findAll(".msg.assistant")).toHaveLength(1);
    expect(wrapper.get(".msg.assistant").attributes("data-msg-id")).toBe("assistant-real");
  });

  it("keeps work activity separate from the avatar-free final reply", async () => {
    const agent = useAgentStore();
    agent.streams.s1 = [
      {
        id: "u1",
        role: "user",
        parts: [{ kind: "text", text: "你好，你可以干什么" }],
        status: "complete",
        createdAt: 1_000,
        metadata: null,
      },
      {
        id: "a1",
        role: "assistant",
        parts: [
          { kind: "thinking", text: "分析请求" },
          {
            kind: "tool_call",
            toolCallId: "call-1",
            name: "bash",
            args: { command: "pnpm test" },
            status: "complete",
            result: "ok",
          },
        ],
        status: "complete",
        createdAt: 2_000,
        metadata: null,
      },
      {
        id: "a2",
        role: "assistant",
        parts: [{ kind: "text", text: "你好，我可以帮助你开发和排查项目。" }],
        status: "complete",
        createdAt: 3_000,
        metadata: null,
      },
      {
        id: "a3",
        role: "assistant",
        parts: [],
        status: "complete",
        createdAt: 4_000,
        metadata: { durationMs: 8_000 },
      },
    ];

    const wrapper = mount(ChatPanel, {
      props: { sessionId: "s1", projectId: "p1" },
      global: {
        stubs: {
          Input: true,
          SkillSelect: true,
          PluginSelect: true,
          ChatExpertPicker: true,
          ChatKbPicker: true,
          ChatKbBanner: true,
          ImportSkillDialog: true,
          ConfirmDialog: true,
        },
      },
    });
    await wrapper.vm.$nextTick();

    const assistantMessages = wrapper.findAll(".msg.assistant");
    expect(assistantMessages).toHaveLength(2);
    expect(assistantMessages[0]!.find(".agent-activity").exists()).toBe(true);
    expect(assistantMessages[0]!.element.firstElementChild?.classList.contains("agent-activity")).toBe(true);
    expect(assistantMessages[1]!.text()).toContain("你好，我可以帮助你开发和排查项目。");
    expect(wrapper.findAll(".msg.assistant .msg-avatar-label")).toHaveLength(0);
    expect(wrapper.findAll(".msg.assistant .msg-actions")).toHaveLength(1);
  });
});
