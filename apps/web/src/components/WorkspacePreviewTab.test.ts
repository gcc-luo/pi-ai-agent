import { describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import type { KbCitationMeta } from "../utils/kb-context.js";
import WorkspacePreviewTab from "./WorkspacePreviewTab.vue";

const FileViewerStub = defineComponent({
  name: "FileViewer",
  props: ["projectId", "path", "hideHeader"],
  setup: (props) => () => h("div", { "data-test": "file-viewer-stub", ...props }),
});
const KbCitationViewerStub = defineComponent({
  name: "KbCitationViewer",
  props: ["citation"],
  setup: () => () => h("div", { "data-test": "citation-viewer-stub" }),
});

const citation: KbCitationMeta = {
  localId: 1,
  chunkId: 2,
  kbName: "Manual",
  fileName: "guide.md",
  titlePath: null,
  pageStart: null,
  pageEnd: null,
};

describe("WorkspacePreviewTab", () => {
  it("renders FileViewer with the selected project and file path", async () => {
    const wrapper = mount(WorkspacePreviewTab, {
      props: { projectId: "project-1", target: { kind: "file", path: "src/main.ts" } },
      global: { stubs: { FileViewer: FileViewerStub, KbCitationViewer: KbCitationViewerStub } },
    });
    await flushPromises();

    expect(wrapper.findComponent(FileViewerStub).props()).toMatchObject({
      projectId: "project-1",
      path: "src/main.ts",
    });
    expect(wrapper.findComponent(KbCitationViewerStub).exists()).toBe(false);
    wrapper.unmount();
  });

  it("renders KbCitationViewer with the selected citation", async () => {
    const wrapper = mount(WorkspacePreviewTab, {
      props: { projectId: "project-1", target: { kind: "citation", citation } },
      global: { stubs: { FileViewer: FileViewerStub, KbCitationViewer: KbCitationViewerStub } },
    });
    await flushPromises();

    expect(wrapper.findComponent(KbCitationViewerStub).props("citation")).toEqual(citation);
    expect(wrapper.findComponent(FileViewerStub).exists()).toBe(false);
    wrapper.unmount();
  });
});
