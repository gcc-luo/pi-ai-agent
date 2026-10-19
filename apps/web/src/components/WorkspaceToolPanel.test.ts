import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, onBeforeUnmount, onMounted, watch } from "vue";
import { useWorkspaceToolsStore, type WorkspaceToolKind } from "../stores/workspace-tools.js";
import WorkspaceToolPanel from "./WorkspaceToolPanel.vue";

vi.mock("../i18n/index.js", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

const mounted = vi.fn();
const unmounted = vi.fn();
const disposed = vi.fn();
const activeChanged = vi.fn();
let pinia: ReturnType<typeof createPinia>;

function makeTool(kind: WorkspaceToolKind) {
  return defineComponent({
    name: `Tool-${kind}`,
    props: { active: Boolean },
    setup(props, { expose }) {
      onMounted(() => mounted(kind));
      onBeforeUnmount(() => unmounted(kind));
      watch(() => props.active, (active) => activeChanged(kind, active), { immediate: true });
      expose({ dispose: () => disposed(kind) });
      return () => h("div", { "data-tool": kind }, kind);
    },
  });
}

const tools = {
  files: makeTool("files"),
  browser: makeTool("browser"),
  terminal: makeTool("terminal"),
};

function mountPanel(sessionId = "session-1") {
  return mount(WorkspaceToolPanel, {
    props: {
      sessionId,
      projectId: "project-1",
      active: true,
      width: 420,
      isResizing: false,
      toolComponents: tools,
    },
    global: { plugins: [pinia] },
  });
}

describe("workspace tool panel shell", () => {
  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    mounted.mockClear();
    unmounted.mockClear();
    disposed.mockClear();
    activeChanged.mockClear();
  });

  it("shows each registered tool in the empty panel state", () => {
    const store = useWorkspaceToolsStore();
    store.togglePanel("session-1", "project-1");
    const wrapper = mountPanel();

    expect(wrapper.text()).toContain("workspaceTools.empty");
    expect(wrapper.findAll('[data-test="empty-tool"]').map((button) => button.text())).toEqual([
      "workspaceTools.files",
      "workspaceTools.browser",
      "workspaceTools.terminal",
    ]);
    wrapper.unmount();
  });

  it("offers only unopened persistent tools in the add menu", async () => {
    const store = useWorkspaceToolsStore();
    store.openTool("session-1", "project-1", "files");
    const wrapper = mountPanel();

    await wrapper.get('[data-test="tool-add-menu"] summary').trigger("click");
    expect(wrapper.findAll('[data-test="add-tool-option"]').map((button) => button.text())).toEqual([
      "workspaceTools.browser",
      "workspaceTools.terminal",
    ]);
    await wrapper.get('[data-test-option="browser"]').trigger("click");
    await nextTick();
    expect(store.panels["session-1"]?.tools).toEqual(["files", "browser"]);
    expect(store.panels["session-1"]?.activeTab).toBe("browser");
    await wrapper.get('[data-test="tool-add-menu"] summary').trigger("click");
    expect(wrapper.findAll('[data-test="add-tool-option"]').map((button) => button.text())).toEqual([
      "workspaceTools.terminal",
    ]);
    wrapper.unmount();
  });

  it("keeps tool components mounted while switching tabs and hiding the panel", async () => {
    const store = useWorkspaceToolsStore();
    store.openTool("session-1", "project-1", "files");
    store.openTool("session-1", "project-1", "browser");
    const wrapper = mountPanel();
    await flushPromises();

    expect(mounted).toHaveBeenCalledTimes(2);
    expect(activeChanged).toHaveBeenCalledWith("browser", true);
    await wrapper.get('[data-test="select-tab-files"]').trigger("click");
    await nextTick();
    expect(activeChanged).toHaveBeenCalledWith("files", true);
    expect(activeChanged).toHaveBeenCalledWith("browser", false);
    expect(unmounted).not.toHaveBeenCalled();
    store.togglePanel("session-1", "project-1");
    await nextTick();
    expect(activeChanged).toHaveBeenCalledWith("files", false);
    expect(unmounted).not.toHaveBeenCalled();
    expect(wrapper.find('[data-tool="files"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("calls dispose before removing an explicitly closed tool", async () => {
    const store = useWorkspaceToolsStore();
    store.openTool("session-1", "project-1", "files");
    const wrapper = mountPanel();
    await flushPromises();

    await wrapper.get('[data-test="close-tab-files"]').trigger("click");
    await flushPromises();

    expect(disposed).toHaveBeenCalledWith("files");
    expect(unmounted).toHaveBeenCalledWith("files");
    expect(store.panels["session-1"]?.tools).toEqual([]);
    expect(store.panels["session-1"]?.visible).toBe(false);
    wrapper.unmount();
  });

  it("waits for asynchronous tool cleanup before removing its tab", async () => {
    let finishDispose: (() => void) | undefined;
    const browser = defineComponent({
      name: "AsyncBrowserTool",
      setup(_, { expose }) {
        expose({
          dispose: () => new Promise<void>((resolve) => { finishDispose = resolve; }),
        });
        return () => h("div", { "data-tool": "browser" }, "browser");
      },
    });
    const store = useWorkspaceToolsStore();
    store.openTool("session-1", "project-1", "browser");
    const wrapper = mount(WorkspaceToolPanel, {
      props: {
        sessionId: "session-1",
        projectId: "project-1",
        active: true,
        width: 420,
        isResizing: false,
        toolComponents: { browser },
      },
      global: { plugins: [pinia] },
    });
    await flushPromises();

    await wrapper.get('[data-test="close-tab-browser"]').trigger("click");
    expect(store.panels["session-1"]?.tools).toEqual(["browser"]);
    expect(wrapper.find('[data-tool="browser"]').exists()).toBe(true);

    finishDispose?.();
    await flushPromises();
    expect(store.panels["session-1"]?.tools).toEqual([]);
    expect(wrapper.find('[data-tool="browser"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
