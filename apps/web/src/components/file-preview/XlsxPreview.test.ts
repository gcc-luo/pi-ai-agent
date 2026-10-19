import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import XlsxPreview from "./XlsxPreview.vue";

vi.mock("../../api/client.js", () => ({ api: { rawFileUrl: vi.fn(() => "/raw.xlsx") } }));
vi.mock("../../i18n/index.js", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

const fetchMock = vi.fn();

describe("XlsxPreview retry", () => {
  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it("retries its failed fetch and reloads when the parent refresh key changes", async () => {
    const wrapper = mount(XlsxPreview, {
      props: { projectId: "project-1", path: "guide.xlsx", reloadKey: 0 },
    });
    await flushPromises();
    expect(wrapper.text()).toContain("fetch failed: 503");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await wrapper.get('[data-test="retry-xlsx"]').trigger("click");
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await wrapper.setProps({ reloadKey: 1 });
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    wrapper.unmount();
  });
});
