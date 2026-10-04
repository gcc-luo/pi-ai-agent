import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";
import ChatCapabilityToolbar from "./ChatCapabilityToolbar.vue";
import { useSkillStore } from "../stores/skill.js";
import { usePluginStore } from "../stores/plugin.js";
import { useConnectorStore } from "../stores/connector.js";
import { useExpertStore } from "../stores/expert.js";
import { useKbStore } from "../stores/kb.js";
import { useKbBindingStore } from "../stores/kb-binding.js";

vi.mock("../i18n/index.js", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

function setup() {
  const skills = useSkillStore();
  const plugins = usePluginStore();
  const connectors = useConnectorStore();
  const experts = useExpertStore();
  const kbs = useKbStore();
  const bindings = useKbBindingStore();
  for (const store of [skills, plugins, experts, kbs])
    vi.spyOn(store, "loadAll").mockResolvedValue(undefined);
  vi.spyOn(plugins, "loadSession").mockResolvedValue(undefined);
  vi.spyOn(connectors, "load").mockResolvedValue(undefined);
  vi.spyOn(bindings, "load").mockResolvedValue(undefined);
  const items = [
    {
      id: "a",
      name: "Alpha 文档",
      description: "文档分析",
      enabled: true,
      status: "enabled",
      scopeType: "user",
    },
    {
      id: "b",
      name: "Beta 邮件",
      description: "发送邮件",
      enabled: true,
      status: "enabled",
      scopeType: "user",
    },
  ];
  skills.skills = items as any;
  plugins.plugins = items as any;
  connectors.connectors = items as any;
  experts.experts = items as any;
  kbs.knowledgeBases = items as any;
  plugins.selectedBySession.session = ["a"];
  bindings.bindings.session = [{ kbId: "a", fileFilter: null }] as any;
  return mount(ChatCapabilityToolbar, {
    props: {
      menuLayout: true,
      mode: "session",
      projectId: "project",
      sessionId: "session",
    },
    global: { stubs: { ConfirmDialog: true } },
  });
}

describe("add menu search", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });
  it.each([
    [1, ".skill-item"],
    [2, ".row"],
    [3, ".plugin-picker-item"],
    [4, ".expert-picker-item"],
    [5, ".kb-picker-item"],
  ] as const)(
    "filters category %i and restores its items after clearing",
    async (index, selector) => {
      const wrapper = setup();
      await wrapper
        .findAll(".capability-menu-category")
        [index]!.trigger("click");
      await flushPromises();
      await wrapper.get('input[type="search"]').setValue("  ALPHA  ");
      const visibleItems = () =>
        wrapper.findAll(selector).filter((item) => item.isVisible());
      expect(visibleItems()).toHaveLength(1);
      expect(visibleItems()[0]!.text()).toContain("Alpha");
      await wrapper.get('input[type="search"]').setValue("does-not-exist");
      expect(visibleItems()).toHaveLength(0);
      expect(
        wrapper
          .findAll(".capability-menu-resource-list")
          .find((item) => item.isVisible())
          ?.text(),
      ).toContain("chat.resourceSearchEmpty");
      await wrapper.get(".capability-menu-search button").trigger("click");
      expect(visibleItems()).toHaveLength(2);
      expect(usePluginStore().selectedBySession.session).toEqual(["a"]);
      expect(useKbBindingStore().bindings.session![0]!.kbId).toBe("a");
      wrapper.unmount();
    },
  );
  it("matches descriptions and resets the query when changing categories", async () => {
    const wrapper = setup();
    await wrapper.findAll(".capability-menu-category")[1]!.trigger("click");
    await wrapper.get('input[type="search"]').setValue("文档 分析");
    expect(
      wrapper.findAll(".skill-item").filter((item) => item.isVisible()),
    ).toHaveLength(1);
    await wrapper.findAll(".capability-menu-category")[5]!.trigger("click");
    expect(
      wrapper.get<HTMLInputElement>('input[type="search"]').element.value,
    ).toBe("");
    expect(
      wrapper.findAll(".kb-picker-item").filter((item) => item.isVisible()),
    ).toHaveLength(2);
    wrapper.unmount();
  });
});
