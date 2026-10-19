import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";
import { NDropdown, NTree } from "naive-ui";
import { api } from "../api/client.js";
import FileTree from "./FileTree.vue";

vi.mock("../api/client.js", () => ({
  api: {
    listFiles: vi.fn(),
    openFile: vi.fn(),
    createFile: vi.fn(),
    renameFile: vi.fn(),
    deleteFile: vi.fn(),
  },
}));
vi.mock("../i18n/index.js", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../stores/agent.js", () => ({ useAgentStore: () => ({ lastFileChange: 0 }) }));

function mountTree(readOnly = false) {
  return mount(FileTree, {
    props: { projectId: "project-1", ...(readOnly ? { readOnly } : {}) },
    global: { plugins: [createPinia()] },
  });
}

describe("FileTree read-only mode", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(api.listFiles).mockClear();
    vi.mocked(api.listFiles).mockResolvedValue([
      { name: "readme.md", path: "readme.md", type: "file" },
    ] as never);
    vi.mocked(api.openFile).mockReset();
  });

  it("omits rename and delete actions and disables context-menu handlers", async () => {
    const wrapper = mountTree(true);
    await flushPromises();

    const tree = wrapper.getComponent(NTree);
    const file = (tree.props("data") as Array<Record<string, unknown>>)[0]!;
    expect(file.suffix).toBeUndefined();
    expect(tree.props("nodeProps")).toBeUndefined();
    expect(wrapper.findAll(".node-action")).toHaveLength(0);
    expect(wrapper.findComponent(NDropdown).exists()).toBe(false);

    wrapper.unmount();
  });

  it("keeps the existing mutation affordances in the default mode", async () => {
    const wrapper = mountTree();
    await flushPromises();

    const tree = wrapper.getComponent(NTree);
    const file = (tree.props("data") as Array<Record<string, unknown>>)[0]!;
    expect(file.suffix).toBeTypeOf("function");
    expect(wrapper.findAll(".node-action")).toHaveLength(2);
    await wrapper.get(".n-tree-node").trigger("contextmenu", { clientX: 20, clientY: 30 });
    expect(wrapper.getComponent(NDropdown).props("show")).toBe(true);

    wrapper.unmount();
  });

  it("emits list errors and retries through api.listFiles", async () => {
    vi.mocked(api.listFiles)
      .mockRejectedValueOnce(new Error("temporary list failure"))
      .mockResolvedValueOnce([{ name: "main.ts", path: "main.ts", type: "file" }] as never);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const wrapper = mountTree(true);
    await flushPromises();

    expect(wrapper.emitted("load-error")?.[0]).toEqual(["temporary list failure"]);
    await (wrapper.vm as unknown as { refresh: () => Promise<void> }).refresh();

    expect(api.listFiles).toHaveBeenCalledTimes(2);
    expect(wrapper.emitted("load-success")).toHaveLength(1);
    wrapper.unmount();
    consoleError.mockRestore();
  });
});
