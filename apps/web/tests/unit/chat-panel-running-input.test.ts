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
});
