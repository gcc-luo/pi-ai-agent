import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { api } from "../api/client.js";
import FileViewer from "./FileViewer.vue";

vi.mock("../api/client.js", () => ({
  api: {
    readFile: vi.fn(),
    rawFileUrl: vi.fn(() => "http://localhost/raw"),
  },
}));
vi.mock("../i18n/index.js", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

describe("FileViewer read retries", () => {
  beforeEach(() => { vi.mocked(api.readFile).mockReset(); });

  it("retries a failed read through api.readFile", async () => {
    vi.mocked(api.readFile)
      .mockRejectedValueOnce(new Error("read failed"))
      .mockResolvedValueOnce({ content: "loaded" } as never);

    const wrapper = mount(FileViewer, {
      props: { projectId: "project-1", path: "src/main.ts", hideHeader: true },
    });
    await flushPromises();
    expect(wrapper.text()).toContain("read failed");
    expect(api.readFile).toHaveBeenCalledTimes(1);

    await wrapper.get('[data-test="retry-file-read"]').trigger("click");
    await flushPromises();
    expect(api.readFile).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain("loaded");
    wrapper.unmount();
  });

  it("reloads the selected file when the browser refresh key changes", async () => {
    vi.mocked(api.readFile).mockResolvedValue({ content: "loaded" } as never);
    const wrapper = mount(FileViewer, {
      props: { projectId: "project-1", path: "src/main.ts", reloadKey: 0 },
    });
    await flushPromises();

    await wrapper.setProps({ reloadKey: 1 });
    await flushPromises();

    expect(api.readFile).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });
});
