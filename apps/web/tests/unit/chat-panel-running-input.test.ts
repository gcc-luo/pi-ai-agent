import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
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

    expect(wrapper.get(".msg.assistant .agent-activity").text()).toContain("正在处理");
    expect(wrapper.get(".msg.assistant .msg-avatar-label").text()).toBe("PI Agent");

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

  it("keeps the agent header above the activity and shows the explicit final reply", async () => {
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
    expect(assistantMessages[0]!.get(".msg-avatar-label").text()).toBe("PI Agent");
    expect(assistantMessages[0]!.find(".agent-activity").exists()).toBe(true);
    expect(assistantMessages[0]!.element.firstElementChild?.classList.contains("msg-avatar-row")).toBe(true);
    expect(assistantMessages[1]!.text()).toContain("你好，我可以帮助你开发和排查项目。");
    expect(wrapper.findAll(".msg.assistant .msg-avatar-label")).toHaveLength(1);
  });
});
