import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import DocxPreview from "./DocxPreview.vue";

vi.mock("../../api/client.js", () => ({ api: { rawFileUrl: vi.fn(() => "/raw.docx") } }));
vi.mock("../../i18n/index.js", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

const fetchMock = vi.fn();

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("DocxPreview retry", () => {
  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it("retries its failed fetch and reloads when the parent refresh key changes", async () => {
    const wrapper = mount(DocxPreview, {
      props: { projectId: "project-1", path: "guide.docx", reloadKey: 0 },
    });
    await flushPromises();
    expect(wrapper.text()).toContain("fetch failed: 503");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await wrapper.get('[data-test="retry-docx"]').trigger("click");
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await wrapper.setProps({ reloadKey: 1 });
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    wrapper.unmount();
  });

  it("does not let an older failed request clear the current request state", async () => {
    const oldFetch = deferred<{ ok: boolean; status: number }>();
    const newFetch = deferred<{ ok: boolean; status: number }>();
    fetchMock.mockReset()
      .mockReturnValueOnce(oldFetch.promise)
      .mockReturnValueOnce(newFetch.promise);
    const wrapper = mount(DocxPreview, {
      props: { projectId: "project-1", path: "old.docx" },
    });
    await flushPromises();
    await wrapper.setProps({ path: "new.docx" });
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    oldFetch.resolve({ ok: false, status: 404 });
    await flushPromises();
    expect(wrapper.text()).toContain("viewer.rendering");
    expect(wrapper.text()).not.toContain("fetch failed: 404");

    newFetch.resolve({ ok: false, status: 503 });
    await flushPromises();
    expect(wrapper.text()).toContain("fetch failed: 503");
    wrapper.unmount();
  });

  it("keeps the retried document load active when the previous fetch fails later", async () => {
    const oldFetch = deferred<{ ok: boolean; status: number }>();
    const retryFetch = deferred<{ ok: boolean; status: number }>();
    fetchMock.mockReset()
      .mockReturnValueOnce(oldFetch.promise)
      .mockReturnValueOnce(retryFetch.promise);
    const wrapper = mount(DocxPreview, {
      props: { projectId: "project-1", path: "guide.docx" },
    });
    await flushPromises();
    (wrapper.vm as unknown as { retry: () => void }).retry();
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    oldFetch.resolve({ ok: false, status: 404 });
    await flushPromises();
    expect(wrapper.text()).toContain("viewer.rendering");
    expect(wrapper.text()).not.toContain("fetch failed: 404");

    retryFetch.resolve({ ok: false, status: 503 });
    await flushPromises();
    expect(wrapper.text()).toContain("fetch failed: 503");
    wrapper.unmount();
  });
});
