import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import PdfPreview from "./PdfPreview.vue";

vi.mock("../../i18n/index.js", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

const fetchMock = vi.fn();

describe("PdfPreview raw endpoint errors", () => {
  beforeEach(() => {
    fetchMock.mockReset()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: "PDF file not found" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 206,
        body: { cancel: vi.fn().mockResolvedValue(undefined) },
      });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it("preflights the raw endpoint, shows server errors, and retries before embedding", async () => {
    const wrapper = mount(PdfPreview, { props: { url: "/api/files/p/raw?path=manual.pdf" } });
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ headers: { Range: "bytes=0-0" } });
    expect(wrapper.text()).toContain("PDF file not found");
    expect(wrapper.find("iframe").exists()).toBe(false);

    await wrapper.get('[data-test="retry-pdf-preview"]').trigger("click");
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(wrapper.get("iframe").attributes("src")).toBe("/api/files/p/raw?path=manual.pdf");
    wrapper.unmount();
  });
});
