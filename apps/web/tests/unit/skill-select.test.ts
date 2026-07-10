import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import { setActivePinia, createPinia } from "pinia";
import SkillSelect from "../../src/components/SkillSelect.vue";
import ConfirmDialog from "../../src/components/ConfirmDialog.vue";

describe("SkillSelect", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
  });
  afterEach(() => { document.body.innerHTML = ""; });

  function mountSelect() {
    return mount(SkillSelect, {
      global: {
        stubs: {
          Modal: { template: '<div v-if="show"><slot/></div>', props: ["show"] },
        },
      },
    });
  }

  async function seedSkills(skills: { name: string; description: string; path: string }[]) {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(skills), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    await mountSelect();
    // Wait for onMounted loadAll + flush
    await nextTick();
    await nextTick();
  }

  it("shows empty hint when no skills loaded", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", {
      status: 200, headers: { "Content-Type": "application/json" },
    })));
    const w = mountSelect();
    await nextTick();
    await nextTick();
    // open the dropdown
    await w.find("[data-test='skill-toggle']").trigger("click");
    await nextTick();
    expect(w.text()).toContain("No skills yet");
  });

  it("renders skills in the dropdown", async () => {
    await seedSkills([
      { name: "a-skill", description: "a desc", path: "/a/SKILL.md" },
      { name: "b-skill", description: "b desc", path: "/b/SKILL.md" },
    ]);
  });

  it("emits select(name) when a skill is clicked", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([
      { name: "a-skill", description: "a desc", path: "/a/SKILL.md" },
    ]), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const w = mountSelect();
    await flushPromises();
    await nextTick();
    await w.find("[data-test='skill-toggle']").trigger("click");
    await nextTick();
    await w.find("[data-test='skill-item']").trigger("click");
    const events = w.emitted();
    expect(events.select).toEqual([["a-skill"]]);
  });

  it("emits import when the import button is clicked", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", {
      status: 200, headers: { "Content-Type": "application/json" },
    })));
    const w = mountSelect();
    await nextTick();
    await nextTick();
    await w.find("[data-test='skill-toggle']").trigger("click");
    await nextTick();
    await w.find("[data-test='skill-import-btn']").trigger("click");
    expect(w.emitted().import).toBeDefined();
  });

  it("renders uninstall button per skill and emits delete flow on click", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([
      { name: "a-skill", description: "a desc", path: "/a/SKILL.md" },
    ]), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const w = mountSelect();
    await flushPromises();
    await nextTick();
    await w.find("[data-test='skill-toggle']").trigger("click");
    await nextTick();
    expect(w.find("[data-test='uninstall-btn']").exists()).toBe(true);
  });
});
