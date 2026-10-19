import { defineStore } from "pinia";
import type { KbCitationMeta } from "../utils/kb-context.js";

export type WorkspaceToolKind = "files" | "browser" | "terminal";
export type WorkspaceTabId = WorkspaceToolKind | "preview";
export type WorkspacePreviewTarget =
  | { kind: "file"; path: string }
  | { kind: "citation"; citation: KbCitationMeta };

export interface WorkspaceSessionPanel {
  projectId: string;
  visible: boolean;
  tools: WorkspaceToolKind[];
  activeTab: WorkspaceTabId | null;
  returnTab: WorkspaceToolKind | null;
  preview: WorkspacePreviewTarget | null;
}

export const WORKSPACE_TOOL_KINDS: WorkspaceToolKind[] = [
  "files",
  "browser",
  "terminal",
];

export const useWorkspaceToolsStore = defineStore("workspace-tools", {
  state: () => ({
    panels: {} as Record<string, WorkspaceSessionPanel>,
  }),
  actions: {
    ensurePanel(sessionId: string, projectId: string): WorkspaceSessionPanel {
      return (this.panels[sessionId] ??= {
        projectId,
        visible: false,
        tools: [],
        activeTab: null,
        returnTab: null,
        preview: null,
      });
    },

    togglePanel(sessionId: string, projectId: string) {
      const panel = this.ensurePanel(sessionId, projectId);
      panel.visible = !panel.visible;
    },

    openTool(sessionId: string, projectId: string, kind: WorkspaceToolKind) {
      const panel = this.ensurePanel(sessionId, projectId);
      if (!panel.tools.includes(kind)) panel.tools.push(kind);
      panel.visible = true;
      panel.activeTab = kind;
    },

    closeTool(sessionId: string, kind: WorkspaceToolKind) {
      const panel = this.panels[sessionId];
      if (!panel || !panel.tools.includes(kind)) return;

      panel.tools = panel.tools.filter((tool) => tool !== kind);
      if (panel.returnTab === kind) {
        panel.returnTab = panel.tools.at(-1) ?? null;
      }

      if (panel.activeTab === kind) {
        panel.activeTab = panel.tools.at(-1) ?? (panel.preview ? "preview" : null);
      }

      if (!panel.tools.length && !panel.preview) {
        panel.visible = false;
        panel.activeTab = null;
        panel.returnTab = null;
      }
    },

    showPreview(
      sessionId: string,
      projectId: string,
      target: WorkspacePreviewTarget,
    ) {
      const panel = this.ensurePanel(sessionId, projectId);
      if (panel.activeTab !== "preview" && panel.activeTab && panel.tools.includes(panel.activeTab)) {
        panel.returnTab = panel.activeTab;
      }
      panel.preview = target;
      panel.visible = true;
      panel.activeTab = "preview";
    },

    closePreview(sessionId: string) {
      const panel = this.panels[sessionId];
      if (!panel?.preview) return;

      panel.preview = null;
      if (panel.activeTab === "preview") {
        panel.activeTab = panel.returnTab && panel.tools.includes(panel.returnTab)
          ? panel.returnTab
          : null;
      }
      panel.returnTab = null;

      if (!panel.tools.length) {
        panel.visible = false;
        panel.activeTab = null;
      }
    },

    setActiveTab(sessionId: string, tab: WorkspaceTabId) {
      const panel = this.panels[sessionId];
      if (!panel) return;
      if (tab === "preview" ? !panel.preview : !panel.tools.includes(tab)) return;
      panel.activeTab = tab;
      panel.visible = true;
    },

    removeSession(sessionId: string) {
      delete this.panels[sessionId];
    },
  },
});
