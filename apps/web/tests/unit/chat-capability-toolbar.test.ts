import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ChatCapabilityToolbar from "../../src/components/ChatCapabilityToolbar.vue";

const SkillStub = defineComponent({
  emits: ["select", "import"],
  setup(_, { emit }) {
    return () => h("button", { class: "skill-stub", onClick: () => emit("select", "daily-brief") });
  },
});

const PluginStub = defineComponent({
  props: { modelValue: { type: Array, default: () => [] } },
  emits: ["update:modelValue"],
  setup(props, { emit }) {
    return () => h("button", {
      class: "plugin-stub",
      onClick: () => emit("update:modelValue", [...(props.modelValue as string[]), "plugin-a"]),
    });
  },
});

const ConnectorStub = defineComponent({
  props: { modelValue: { type: Array, default: () => [] } },
  emits: ["update:modelValue"],
  setup(props, { emit }) {
    return () => h("button", {
      class: "connector-stub",
      onClick: () => emit("update:modelValue", [...(props.modelValue as string[]), "connector-a"]),
    });
  },
});

const ExpertStub = defineComponent({
  props: { modelValue: { type: String, default: null } },
  emits: ["update:modelValue"],
  setup(_, { emit }) {
    return () => h("button", { class: "expert-stub", onClick: () => emit("update:modelValue", "expert-a") });
  },
});

describe("ChatCapabilityToolbar", () => {
  it("propagates draft capability selections through the shared toolbar", async () => {
    const wrapper = mount(ChatCapabilityToolbar, {
      props: {
        mode: "draft",
        projectId: "project-a",
        skillNames: [],
        pluginIds: [],
        connectorIds: [],
        expertId: null,
      },
      global: {
        stubs: {
          SkillSelect: SkillStub,
          PluginSelect: PluginStub,
          ConnectorSelect: ConnectorStub,
          ChatExpertPicker: ExpertStub,
          ChatKbPicker: true,
        },
      },
    });

    await wrapper.get(".skill-stub").trigger("click");
    await wrapper.get(".plugin-stub").trigger("click");
    await wrapper.get(".connector-stub").trigger("click");
    await wrapper.get(".expert-stub").trigger("click");

    expect(wrapper.emitted("select-skill")?.[0]).toEqual(["daily-brief"]);
    expect(wrapper.emitted("update:pluginIds")?.[0]).toEqual([["plugin-a"]]);
    expect(wrapper.emitted("update:connectorIds")?.[0]).toEqual([["connector-a"]]);
    expect(wrapper.emitted("update:expertId")?.[0]).toEqual(["expert-a"]);
  });
});
