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
      props: { sessionId: "s1" },
      global: {
        stubs: {
          Modal: { template: '<div v-if="show"><slot/></div>', props: ["show"] },
          Input: {
            template: '<textarea :value="value" @input="$emit(\'update:value\', $event.target.value)" @keydown="$emit(\'keydown\', $event)"></textarea>',
            props: ["value"],
          },
        },
      },
    });
  }

  async function openSkillDropdown(w: ReturnType<typeof mountPanel>) {
    await w.find("[data-test='skill-toggle']").trigger("click");
    await nextTick();
  }

  it("inserts /skill:<name> into empty textarea on select", async () => {
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
    const textarea = w.find("textarea").element as HTMLTextAreaElement;
    expect(textarea.value).toBe("/skill:demo-skill ");
  });

  it("appends /skill:<name> with separator when textarea has content", async () => {
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
    expect((w.find("textarea").element as HTMLTextAreaElement).value).toBe("existing text /skill:demo-skill ");
  });

  it("does not double-space when textarea ends with whitespace", async () => {
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
    expect((w.find("textarea").element as HTMLTextAreaElement).value).toBe("existing text\n/skill:demo-skill ");
  });

  it("opens ImportSkillDialog when import is emitted", async () => {
    const w = mountPanel();
    await nextTick();
    await nextTick();
    await openSkillDropdown(w);
    await w.find("[data-test='skill-import-btn']").trigger("click");
    await nextTick();
    expect(w.find("[data-test='import-skill-dialog']").exists()).toBe(true);
  });
});
