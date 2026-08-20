import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { nextTick, defineComponent } from "vue";
import SkillStoreView from "../../src/components/SkillStoreView.vue";

vi.mock("naive-ui", async () => {
  const actual = await vi.importActual<typeof import("naive-ui")>("naive-ui");
  return { ...actual, useMessage: () => ({ error: vi.fn(), success: vi.fn() }) };
});

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
        NTabs: NTabsStub,
        NTabPane: { template: '<div><slot/></div>' },
        NButton: { template: '<button><slot/></button>' },
        NInput: { template: '<input />', inheritAttrs: false },
        NRadioGroup: { template: '<div><slot/></div>' },
        NRadio: { template: '<div><slot/></div>' },
        NTag: { template: '<div><slot/></div>' },
        NSpin: { template: '<div></div>' },
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

    const cards = w.findAll('[data-test="installed-card"]');
    expect(cards.length).toBe(2);
    expect(cards[0]!.text()).toContain("my-skill");
    expect(cards[0]!.text()).toContain("does X");
    expect(cards[0]!.text()).toContain("/a/b/my-skill");
    expect(cards[1]!.text()).toContain("other-skill");
  });
});
