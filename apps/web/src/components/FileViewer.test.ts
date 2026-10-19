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

  it("ignores an older read that resolves after the newly selected file", async () => {
    let rejectOld!: (reason: Error) => void;
    const oldRead = new Promise<{ content: string }>((resolve, reject) => {
      rejectOld = reject;
    });
    let resolveNew!: (value: { content: string }) => void;
    const newRead = new Promise<{ content: string }>((resolve) => { resolveNew = resolve; });
    vi.mocked(api.readFile)
      .mockReturnValueOnce(oldRead as never)
      .mockReturnValueOnce(newRead as never);

    const wrapper = mount(FileViewer, {
      props: { projectId: "project-1", path: "src/old.ts", hideHeader: true },
    });
    await flushPromises();
    await wrapper.setProps({ path: "src/new.ts" });
    await flushPromises();

    rejectOld(new Error("stale read failed"));
    await flushPromises();
    expect(wrapper.text()).not.toContain("stale read failed");
    expect(wrapper.find(".viewer-state").exists()).toBe(true);

    resolveNew({ content: "new file contents" });
    await flushPromises();
    expect(wrapper.text()).toContain("new file contents");
    expect(wrapper.text()).not.toContain("stale read failed");
    wrapper.unmount();
  });

  it("keeps a retry active when the previous attempt fails later", async () => {
    let rejectOld!: (reason: Error) => void;
    const oldRead = new Promise<{ content: string }>((_, reject) => { rejectOld = reject; });
    let resolveRetry!: (value: { content: string }) => void;
    const retryRead = new Promise<{ content: string }>((resolve) => { resolveRetry = resolve; });
    vi.mocked(api.readFile)
      .mockReturnValueOnce(oldRead as never)
      .mockReturnValueOnce(retryRead as never);

    const wrapper = mount(FileViewer, {
      props: { projectId: "project-1", path: "src/main.ts", hideHeader: true },
    });
    await flushPromises();
    (wrapper.vm as unknown as { retry: () => void }).retry();
    await flushPromises();
    expect(api.readFile).toHaveBeenCalledTimes(2);

    rejectOld(new Error("old attempt failed"));
    await flushPromises();
    expect(wrapper.text()).not.toContain("old attempt failed");
    expect(wrapper.find(".viewer-state").exists()).toBe(true);

    resolveRetry({ content: "retry succeeded" });
    await flushPromises();
    expect(wrapper.text()).toContain("retry succeeded");
    wrapper.unmount();
  });

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
