import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { api } from "../api/client.js";
import KbSearchTab from "./KbSearchTab.vue";
vi.mock("../api/client.js", () => ({ api: { searchKb: vi.fn() } }));
vi.mock("../i18n/index.js", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
const stubs = {
  NInput: {
    props: ["value"],
    emits: ["update:value"],
    template: `<input :value="value" @input="$emit('update:value', $event.target.value)" />`,
  },
  NButton: { template: "<button><slot /></button>" },
  NSelect: true,
  NSpin: true,
  NEmpty: { props: ["description"], template: "<div>{{ description }}</div>" },
};
describe("knowledge search feedback", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });
  it("distinguishes a failed request from an empty search", async () => {
    vi.mocked(api.searchKb).mockRejectedValue(new Error("Network unavailable"));
    const wrapper = mount(KbSearchTab, {
      props: { kbId: "a" },
      global: { stubs },
    });
    await wrapper.get("input").setValue("query");
    await wrapper.get("button").trigger("click");
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("Network unavailable");
    expect(wrapper.text()).not.toContain("kb.search.noResults");
    wrapper.unmount();
  });
  it("discards a response after switching knowledge bases", async () => {
    let resolve!: (value: any) => void;
    vi.mocked(api.searchKb).mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const wrapper = mount(KbSearchTab, {
      props: { kbId: "a" },
      global: { stubs },
    });
    await wrapper.get("input").setValue("query");
    await wrapper.get("button").trigger("click");
    await wrapper.setProps({ kbId: "b" });
    resolve({
      hits: [{ chunkId: 1, fileName: "old-result", snippet: "old", score: 1 }],
      durationMs: 1,
    });
    await flushPromises();
    expect(wrapper.text()).not.toContain("old-result");
    expect(wrapper.get("input").element.value).toBe("");
    wrapper.unmount();
  });

  it("explains when semantic search fell back to keywords", async () => {
    vi.mocked(api.searchKb).mockResolvedValue({
      hits: [{ chunkId: 1, fileName: "spring.md", snippet: "spring content", score: 1 } as any],
      durationMs: 2,
      diagnostics: {
        mode: "keyword",
        semanticStatus: "not_configured",
        searchableChunkCount: 1,
        indexedChunkCount: 0,
        keywordCandidateCount: 1,
        semanticCandidateCount: 0,
        normalizedQuery: "spring",
      },
    });
    const wrapper = mount(KbSearchTab, { props: { kbId: "a" }, global: { stubs } });
    await wrapper.get("input").setValue("spring");
    await wrapper.get("button").trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("kb.chat.card.mode.keyword");
    expect(wrapper.text()).toContain("kb.chat.card.keywordFallback");
    wrapper.unmount();
  });
});
