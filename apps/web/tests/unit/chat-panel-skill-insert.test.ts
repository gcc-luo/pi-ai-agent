import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import { setActivePinia, createPinia } from "pinia";
import ChatPanel from "../../src/components/ChatPanel.vue";

describe("ChatPanel skill insertion", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
  });
  afterEach(() => { document.body.innerHTML = ""; });

  function mountPanel() {
    return mount(ChatPanel, {
      props: { sessionId: "s1", projectId: "p1" },
      global: {
        stubs: {
          NModal: { template: '<div><slot/></div>' },
          NInput: {
            inheritAttrs: false,
            template: '<div v-bind="$attrs"><textarea :value="value" @input="$emit(\'update:value\', $event.target.value)" @keydown="$emit(\'keydown\', $event)"></textarea></div>',
            props: ["value", "type"],
          },
          SkillSelect: {
            emits: ["select", "import"],
            data: () => ({ open: false }),
            template: `<div>
              <button data-test="skill-toggle" @click="open = true">skills</button>
              <button v-if="open" data-test="skill-item" @click="$emit('select', 'demo-skill')">demo</button>
              <button v-if="open" data-test="skill-import-btn" @click="$emit('import')">import</button>
            </div>`,
          },
          ChatExpertPicker: true,
          ChatKbPicker: true,
          PluginSelect: true,
          ConfirmDialog: true,
          FileViewer: true,
          ArtifactCard: true,
          ImportSkillDialog: { template: '<div data-test="import-skill-dialog" />' },
        },
      },
    });
  }

  async function openSkillDropdown(w: ReturnType<typeof mountPanel>) {
    await w.find("[data-test='skill-toggle']").trigger("click");
    await nextTick();
  }

  it("shows the selected skill as a composer chip", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([
      { name: "demo-skill", description: "d", path: "/d/SKILL.md" },
    ]), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const w = mountPanel();
    await flushPromises();
    await nextTick();
    await openSkillDropdown(w);
    await w.find("[data-test='skill-item']").trigger("click");
    await nextTick();
    expect(w.find(".skill-chip .chip-name").text()).toBe("demo-skill");
  });

  it("keeps the message text separate from selected skills", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([
      { name: "demo-skill", description: "d", path: "/d/SKILL.md" },
    ]), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const w = mountPanel();
    await nextTick();
    await nextTick();
    const textarea = w.find("textarea");
    await textarea.setValue("existing text");
    await openSkillDropdown(w);
    await w.find("[data-test='skill-item']").trigger("click");
    await nextTick();
    expect((w.find("textarea").element as HTMLTextAreaElement).value).toBe("existing text");
    expect(w.find(".skill-chip .chip-name").text()).toBe("demo-skill");
  });

  it("preserves whitespace in the message text when selecting a skill", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([
      { name: "demo-skill", description: "d", path: "/d/SKILL.md" },
    ]), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const w = mountPanel();
    await nextTick();
    await nextTick();
    const textarea = w.find("textarea");
    await textarea.setValue("existing text\n");
    await openSkillDropdown(w);
    await w.find("[data-test='skill-item']").trigger("click");
    await nextTick();
    expect((w.find("textarea").element as HTMLTextAreaElement).value).toBe("existing text\n");
    expect(w.find(".skill-chip .chip-name").text()).toBe("demo-skill");
  });

  it("opens ImportSkillDialog when import is emitted", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", {
      status: 200, headers: { "Content-Type": "application/json" },
    })));
    const w = mountPanel();
    await nextTick();
    await nextTick();
    await openSkillDropdown(w);
    await w.find("[data-test='skill-import-btn']").trigger("click");
    await nextTick();
    expect(w.find("[data-test='import-skill-dialog']").exists()).toBe(true);
  });
});
