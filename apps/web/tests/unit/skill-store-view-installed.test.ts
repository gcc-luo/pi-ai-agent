import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { nextTick, defineComponent } from "vue";
import SkillStoreView from "../../src/components/SkillStoreView.vue";
import { useSkillStore } from "../../src/stores/skill.js";

const NTabsStub = defineComponent({
  props: ["value"],
  emits: ["update:value"],
  template: `
    <div>
      <button data-test="tab-market" @click="$emit('update:value', 'market')">market</button>
      <button data-test="tab-installed" @click="$emit('update:value', 'installed')">installed</button>
    </div>`,
});

function mountView() {
  return mount(SkillStoreView, {
    global: {
      stubs: {
        Tabs: NTabsStub,
        TabPane: { template: '<div><slot/></div>' },
        Button: { template: '<button><slot/></button>' },
        Input: { template: '<input />', inheritAttrs: false },
        RadioGroup: { template: '<div><slot/></div>' },
        Radio: { template: '<div><slot/></div>' },
        Tag: { template: '<div><slot/></div>' },
        Spin: { template: '<div></div>' },
        CreateSkillDialog: { template: '<div></div>' },
        ImportSkillDialog: { template: '<div></div>' },
        ConfirmDialog: { template: '<div></div>' },
      },
    },
  });
}

describe("SkillStoreView installed tab", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });
  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("renders installed skills as cards when installed tab is active", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(
        JSON.stringify([
          { name: "my-skill", description: "does X", path: "/a/b/my-skill" },
          { name: "other-skill", description: "does Y", path: "/c/other-skill" },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const w = mountView();
    await flushPromises();
    await nextTick();

    await w.find('[data-test="tab-installed"]').trigger("click");
    await flushPromises();
    await nextTick();

    const cards = w.findAll('[data-test="installed-card"]');
    expect(cards.length).toBe(2);
    expect(cards[0]!.text()).toContain("my-skill");
    expect(cards[0]!.text()).toContain("does X");
    expect(cards[0]!.text()).toContain("/a/b/my-skill");
    expect(cards[1]!.text()).toContain("other-skill");
  });
});
