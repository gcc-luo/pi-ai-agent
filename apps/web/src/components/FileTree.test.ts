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

  it("keeps the legacy select event while identifying file selections separately", async () => {
    vi.mocked(api.listFiles).mockResolvedValue([
      { name: "src", path: "src", type: "directory", children: [
        { name: "main.ts", path: "src/main.ts", type: "file" },
      ] },
    ] as never);
    const wrapper = mountTree(true);
    await flushPromises();
    const tree = wrapper.getComponent(NTree);

    tree.vm.$emit("update:selected-keys", ["src"]);
    await flushPromises();
    expect(wrapper.emitted("select")?.at(-1)).toEqual(["src"]);
    expect(wrapper.emitted("select-file")).toBeUndefined();

    tree.vm.$emit("update:selected-keys", ["src/main.ts"]);
    await flushPromises();
    expect(wrapper.emitted("select")?.at(-1)).toEqual(["src/main.ts"]);
    expect(wrapper.emitted("select-file")?.at(-1)).toEqual(["src/main.ts"]);
    wrapper.unmount();
  });

  it("clears the previous project tree and ignores its late list response", async () => {
    let rejectStale!: (reason: Error) => void;
    let resolveCurrent!: (nodes: Array<{ name: string; path: string; type: string }>) => void;
    const staleList = new Promise<Array<{ name: string; path: string; type: string }>>((_, reject) => {
      rejectStale = reject;
    });
    const currentList = new Promise<Array<{ name: string; path: string; type: string }>>((resolve) => {
      resolveCurrent = resolve;
    });
    let projectOneCalls = 0;
    vi.mocked(api.listFiles).mockImplementation((projectId) => {
      if (projectId === "project-1") {
        projectOneCalls++;
        return (projectOneCalls === 1
          ? Promise.resolve([{ name: "old.ts", path: "old.ts", type: "file" }])
          : staleList) as never;
      }
      return currentList as never;
    });
    const wrapper = mountTree(true);
    await flushPromises();
    wrapper.getComponent(NTree).vm.$emit("update:selected-keys", ["old.ts"]);
    await flushPromises();
    void (wrapper.vm as unknown as { refresh: () => Promise<void> }).refresh();

    await wrapper.setProps({ projectId: "project-2" });
    await flushPromises();
    expect(wrapper.getComponent(NTree).props("data")).toEqual([]);
    expect(wrapper.getComponent(NTree).props("selectedKeys")).toEqual([]);
    expect((wrapper.vm as unknown as { loading: boolean }).loading).toBe(true);
    expect((wrapper.vm as unknown as { loadError: string | null }).loadError).toBeNull();

    rejectStale(new Error("stale project failed"));
    await flushPromises();
    expect((wrapper.vm as unknown as { loading: boolean }).loading).toBe(true);
    expect((wrapper.vm as unknown as { loadError: string | null }).loadError).toBeNull();
    expect(wrapper.emitted("load-error")).toBeUndefined();

    resolveCurrent([{ name: "new.ts", path: "new.ts", type: "file" }]);
    await flushPromises();
    expect((wrapper.getComponent(NTree).props("data") as Array<{ key: string }>)[0]?.key).toBe("new.ts");
    expect((wrapper.vm as unknown as { loading: boolean }).loading).toBe(false);
    expect((wrapper.vm as unknown as { loadError: string | null }).loadError).toBeNull();
    expect((wrapper.getComponent(NTree).props("data") as Array<{ key: string }>)[0]?.key).toBe("new.ts");
    wrapper.unmount();
  });

  it("clears the prior list error when the project changes", async () => {
    let resolveProjectTwo!: (nodes: Array<{ name: string; path: string; type: string }>) => void;
    const projectTwoList = new Promise<Array<{ name: string; path: string; type: string }>>((resolve) => {
      resolveProjectTwo = resolve;
    });
    vi.mocked(api.listFiles)
      .mockRejectedValueOnce(new Error("project one failed"))
      .mockReturnValueOnce(projectTwoList as never);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const wrapper = mountTree(true);
    await flushPromises();
    expect((wrapper.vm as unknown as { loadError: string | null }).loadError).toBe("project one failed");

    await wrapper.setProps({ projectId: "project-2" });
    await flushPromises();
    expect((wrapper.vm as unknown as { loadError: string | null }).loadError).toBeNull();
    expect((wrapper.vm as unknown as { loading: boolean }).loading).toBe(true);

    resolveProjectTwo([{ name: "new.ts", path: "new.ts", type: "file" }]);
    await flushPromises();
    expect((wrapper.vm as unknown as { loading: boolean }).loading).toBe(false);
    wrapper.unmount();
    consoleError.mockRestore();
  });
});
