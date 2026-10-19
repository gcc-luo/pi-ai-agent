import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useWorkspaceToolsStore } from "./workspace-tools.js";

describe("workspace tool panels", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("creates a visible panel on first toggle and preserves its original project", () => {
    const store = useWorkspaceToolsStore();

    store.togglePanel("session-1", "project-1");
    store.togglePanel("session-1", "project-2");

    expect(store.panels["session-1"]).toEqual({
      projectId: "project-1",
      visible: false,
      tools: [],
      activeTab: null,
      returnTab: null,
      preview: null,
    });
  });

  it("opens multiple instances of each tool and selects the last remaining instance on close", () => {
    const store = useWorkspaceToolsStore();

    store.openTool("session-1", "project-1", "files");
    store.openTool("session-1", "project-1", "browser");
    store.openTool("session-1", "project-1", "files");
    store.closeTool("session-1", "browser");

    expect(store.panels["session-1"]?.tools).toEqual(["files", "files--1"]);
    expect(store.panels["session-1"]?.activeTab).toBe("files--1");
    expect(store.panels["session-1"]?.visible).toBe(true);
  });

  it("returns from preview to the persistent tool that opened it", () => {
    const store = useWorkspaceToolsStore();
    const fileTarget = { kind: "file" as const, path: "/project/a.txt" };

    store.openTool("session-1", "project-1", "files");
    store.showPreview("session-1", "project-1", fileTarget);
    store.showPreview("session-1", "project-1", { kind: "file", path: "/project/b.txt" });
    store.closePreview("session-1");

    expect(store.panels["session-1"]?.preview).toBeNull();
    expect(store.panels["session-1"]?.activeTab).toBe("files");
    expect(store.panels["session-1"]?.visible).toBe(true);
  });

  it("falls back to the last open tool when preview has no return tab", () => {
    const store = useWorkspaceToolsStore();
    store.openTool("session-1", "project-1", "files");
    store.openTool("session-1", "project-1", "browser");
    store.showPreview("session-1", "project-1", { kind: "file", path: "/a" });
    store.panels["session-1"]!.returnTab = null;

    store.closePreview("session-1");

    expect(store.panels["session-1"]?.activeTab).toBe("browser");
  });

  it("does not overwrite the preview return tab when a tool is opened from preview", () => {
    const store = useWorkspaceToolsStore();

    store.openTool("session-1", "project-1", "files");
    store.showPreview("session-1", "project-1", { kind: "file", path: "/a" });
    store.openTool("session-1", "project-1", "browser");
    store.closePreview("session-1");

    expect(store.panels["session-1"]?.activeTab).toBe("browser");
    expect(store.panels["session-1"]?.returnTab).toBeNull();
  });

  it("updates the preview return tab when its tool closes and hides after the last tab closes", () => {
    const store = useWorkspaceToolsStore();

    store.openTool("session-1", "project-1", "files");
    store.openTool("session-1", "project-1", "terminal");
    store.showPreview("session-1", "project-1", { kind: "file", path: "/a" });
    store.closeTool("session-1", "files");
    store.closePreview("session-1");

    expect(store.panels["session-1"]?.activeTab).toBe("terminal");
    store.closeTool("session-1", "terminal");
    expect(store.panels["session-1"]?.activeTab).toBeNull();
    expect(store.panels["session-1"]?.visible).toBe(false);
  });

  it("selects the last remaining tab when closing an active tool with preview open", () => {
    const store = useWorkspaceToolsStore();
    store.openTool("session-1", "project-1", "files");
    store.openTool("session-1", "project-1", "browser");
    store.showPreview("session-1", "project-1", { kind: "file", path: "/a" });
    store.setActiveTab("session-1", "browser");

    store.closeTool("session-1", "browser");

    expect(store.panels["session-1"]?.activeTab).toBe("preview");
  });

  it("does not change the active tool when a background preview is closed", () => {
    const store = useWorkspaceToolsStore();

    store.openTool("session-1", "project-1", "files");
    store.showPreview("session-1", "project-1", { kind: "file", path: "/a" });
    store.openTool("session-1", "project-1", "terminal");
    store.closePreview("session-1");

    expect(store.panels["session-1"]?.activeTab).toBe("terminal");
    expect(store.panels["session-1"]?.visible).toBe(true);
  });

  it("removes the panel state for a deleted session", () => {
    const store = useWorkspaceToolsStore();
    store.openTool("session-1", "project-1", "files");

    store.removeSession("session-1");

    expect(store.panels["session-1"]).toBeUndefined();
  });
});
