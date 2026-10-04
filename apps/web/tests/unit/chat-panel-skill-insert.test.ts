import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import { setActivePinia, createPinia } from "pinia";
import ChatPanel from "../../src/components/ChatPanel.vue";
import { getComposerPlainText } from "../../src/utils/composer-tokens.js";

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
          SkillSelect: {
            emits: ["select", "import"],
            props: ["inline"],
            template: `<div>
              <button data-test="skill-item" @click="$emit('select', 'demo-skill')">demo</button>
              <button data-test="skill-import-btn" @click="$emit('import')">import</button>
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
    await w.find(".composer-add-trigger").trigger("click");
    await nextTick();
    const skillCategory = w.findAll(".capability-menu-category").find((item) => item.text().includes("技能"));
    expect(skillCategory).toBeDefined();
    await skillCategory?.trigger("click");
    await nextTick();
  }

  async function selectDemoSkill(w: ReturnType<typeof mountPanel>) {
    await w.find("[data-test='skill-item']").trigger("click");
    await nextTick();
  }

  it("shows the selected skill as an inline composer token", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([
      { name: "demo-skill", description: "d", path: "/d/SKILL.md" },
    ]), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const w = mountPanel();
    await flushPromises();
    await nextTick();
    await openSkillDropdown(w);
    await selectDemoSkill(w);
    expect(w.find(".composer-resource-token-label").text()).toBe("demo-skill");
  });

  it("keeps the message text separate from the skill token", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([
      { name: "demo-skill", description: "d", path: "/d/SKILL.md" },
    ]), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const w = mountPanel();
    await nextTick();
    await nextTick();
    const editor = w.get('[data-test="composer-prompt-editor"]');
    editor.element.textContent = "existing text";
    await editor.trigger("input");
    await openSkillDropdown(w);
    await selectDemoSkill(w);
    expect(getComposerPlainText(editor.element as HTMLElement).trimEnd()).toBe("existing text");
    expect(editor.find(".composer-resource-token-label").text()).toBe("demo-skill");
  });

  it("preserves whitespace in the message text when selecting a skill", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([
      { name: "demo-skill", description: "d", path: "/d/SKILL.md" },
    ]), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const w = mountPanel();
    await nextTick();
    await nextTick();
    const editor = w.get('[data-test="composer-prompt-editor"]');
    editor.element.textContent = "existing text\n";
    const range = document.createRange();
    range.setStart(editor.element.firstChild!, editor.element.textContent!.length);
    range.collapse(true);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    await editor.trigger("input");
    await openSkillDropdown(w);
    await selectDemoSkill(w);
    expect(getComposerPlainText(editor.element as HTMLElement)).toBe("existing text\n ");
    expect(editor.find(".composer-resource-token-label").text()).toBe("demo-skill");
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
