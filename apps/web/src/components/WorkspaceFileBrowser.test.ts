import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import WorkspaceFileBrowser from "./WorkspaceFileBrowser.vue";

const refreshTree = vi.fn();

vi.mock("../i18n/index.js", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

const FileTreeStub = defineComponent({
  name: "FileTree",
  props: ["projectId", "readOnly"],
  emits: ["select", "load-error"],
  setup(_, { expose }) {
    expose({ refresh: refreshTree });
    return () => h("button", { "data-test": "mock-file", onClick: () => undefined });
  },
});
const FileViewerStub = defineComponent({
  name: "FileViewer",
  props: ["projectId", "path", "hideHeader", "reloadKey"],
  setup: (props) => () => h("div", { "data-test": "mock-preview", ...props }),
});

describe("WorkspaceFileBrowser", () => {
  beforeEach(() => {
    refreshTree.mockReset();
  });

  it("keeps tree selection in its preview and refreshes the list and file", async () => {
    const wrapper = mount(WorkspaceFileBrowser, {
      props: { projectId: "project-1" },
      global: { stubs: { FileTree: FileTreeStub, FileViewer: FileViewerStub } },
    });

    wrapper.getComponent(FileTreeStub).vm.$emit("select", "src/main.ts");
    await flushPromises();
    expect(wrapper.getComponent(FileViewerStub).props()).toMatchObject({
      projectId: "project-1",
      path: "src/main.ts",
    });
    expect(wrapper.getComponent(FileViewerStub).props("hideHeader")).toBe("");

    await wrapper.get('[data-test="refresh-files"]').trigger("click");
    expect(refreshTree).toHaveBeenCalledOnce();
    expect(wrapper.getComponent(FileViewerStub).props("reloadKey")).toBe(1);
    wrapper.unmount();
  });

  it("shows a retry action for list errors", async () => {
    const wrapper = mount(WorkspaceFileBrowser, {
      props: { projectId: "project-1" },
      global: { stubs: { FileTree: FileTreeStub, FileViewer: FileViewerStub } },
    });

    wrapper.getComponent(FileTreeStub).vm.$emit("load-error", "list failed");
    await flushPromises();
    expect(wrapper.text()).toContain("list failed");
    await wrapper.get('[data-test="retry-file-list"]').trigger("click");
    expect(refreshTree).toHaveBeenCalledOnce();

    wrapper.unmount();
  });
});
