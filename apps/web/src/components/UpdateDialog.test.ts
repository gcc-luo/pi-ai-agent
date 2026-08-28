import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import UpdateDialog from "./UpdateDialog.vue";

const mockStore = vi.hoisted(() => ({
  status: "available" as string,
  updateInfo: {
    version: "2.0.0",
    date: "2026-08-28",
    body: "## 更新重点\n\n- 主题适配\n- Markdown 公告",
  } as { version: string; date: string | null; body: string } | null,
  downloadProgress: 42,
  errorMessage: null as string | null,
  downloadAndInstall: vi.fn(),
  installAndRestart: vi.fn(),
  reset: vi.fn(),
}));

vi.mock("../stores/update.js", () => ({
  useUpdateStore: () => mockStore,
}));

function mountDialog() {
  return mount(UpdateDialog, {
    props: { show: true },
    global: {
      stubs: {
        Modal: {
          name: "Modal",
          template: '<div v-if="show"><slot /></div>',
          props: ["show"],
        },
        Progress: {
          template: '<div data-test="progress">{{ percentage }}%</div>',
          props: ["percentage"],
        },
      },
    },
  });
}

describe("UpdateDialog", () => {
  beforeEach(() => {
    mockStore.status = "available";
    mockStore.updateInfo = {
      version: "2.0.0",
      date: "2026-08-28",
      body: "## 更新重点\n\n- 主题适配\n- Markdown 公告",
    };
    mockStore.downloadProgress = 42;
    mockStore.errorMessage = null;
    vi.clearAllMocks();
  });

  it("renders the version and formatted markdown release notes", () => {
    const wrapper = mountDialog();

    expect(wrapper.text()).toContain("v2.0.0");
    expect(wrapper.text()).toContain("2026-08-28");
    expect(wrapper.find(".update-notes-content h2").text()).toBe("更新重点");
    expect(wrapper.findAll(".update-notes-content li")).toHaveLength(2);
  });

  it("renders current release information without an update action", () => {
    mockStore.status = "release-info";

    const wrapper = mountDialog();

    expect(wrapper.text()).toContain("v2.0.0");
    expect(wrapper.find("[data-test=update-download]").exists()).toBe(false);
    expect(wrapper.find("[data-test=update-later]").text()).toContain("关闭");
  });

  it("hides the release notes region when the body is empty", () => {
    mockStore.updateInfo!.body = "";

    const wrapper = mountDialog();

    expect(wrapper.find(".update-notes").exists()).toBe(false);
    expect(wrapper.find(".update-notes-label").exists()).toBe(false);
  });

  it("resets and closes when later is clicked", async () => {
    const wrapper = mountDialog();

    await wrapper.get("[data-test=update-later]").trigger("click");

    expect(mockStore.reset).toHaveBeenCalledOnce();
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("starts the download when the primary action is clicked", async () => {
    const wrapper = mountDialog();

    await wrapper.get("[data-test=update-download]").trigger("click");

    expect(mockStore.downloadAndInstall).toHaveBeenCalledOnce();
  });

  it("resets and closes when the modal requests a close", async () => {
    const wrapper = mountDialog();

    await wrapper.findComponent({ name: "Modal" }).vm.$emit("update:show", false);

    expect(mockStore.reset).toHaveBeenCalledOnce();
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("renders download progress", () => {
    mockStore.status = "downloading";

    const wrapper = mountDialog();

    expect(wrapper.get("[data-test=progress]").text()).toBe("42%");
    expect(wrapper.text()).toContain("正在下载更新");
  });

  it("restarts from the ready state", async () => {
    mockStore.status = "ready";

    const wrapper = mountDialog();
    await wrapper.get("[data-test=update-restart]").trigger("click");

    expect(mockStore.installAndRestart).toHaveBeenCalledOnce();
  });

  it("shows the original error detail", () => {
    mockStore.status = "error";
    mockStore.errorMessage = "Download failed";

    const wrapper = mountDialog();

    expect(wrapper.text()).toContain("更新失败");
    expect(wrapper.text()).toContain("Download failed");
  });

  it("closes the error state and resets the store", async () => {
    mockStore.status = "error";

    const wrapper = mountDialog();
    await wrapper.get("[data-test=update-later]").trigger("click");

    expect(mockStore.reset).toHaveBeenCalledOnce();
    expect(wrapper.emitted("close")).toHaveLength(1);
  });
});
