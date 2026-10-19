import { defineStore } from "pinia";
import type { KbCitationMeta } from "../utils/kb-context.js";

export type WorkspaceToolKind = "files" | "browser" | "terminal";
export type WorkspaceTabId = string;
export type WorkspacePreviewTarget =
  | { kind: "file"; path: string }
  | { kind: "citation"; citation: KbCitationMeta };

export interface WorkspaceSessionPanel {
  projectId: string;
  visible: boolean;
  tools: WorkspaceTabId[];
  activeTab: WorkspaceTabId | null;
  returnTab: WorkspaceTabId | null;
  preview: WorkspacePreviewTarget | null;
}

export const WORKSPACE_TOOL_KINDS: WorkspaceToolKind[] = [
  "files",
  "browser",
  "terminal",
];

export function workspaceToolKind(tabId: WorkspaceTabId): WorkspaceToolKind | null {
  if (tabId === "preview") return null;
  const kind = tabId.split("--", 1)[0];
  return WORKSPACE_TOOL_KINDS.includes(kind as WorkspaceToolKind)
    ? kind as WorkspaceToolKind
    : null;
}

export const useWorkspaceToolsStore = defineStore("workspace-tools", {
  state: () => ({
    panels: {} as Record<string, WorkspaceSessionPanel>,
    nextTabInstance: 0,
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

    openTool(sessionId: string, projectId: string, kind: WorkspaceToolKind): WorkspaceTabId {
      const panel = this.ensurePanel(sessionId, projectId);
      const existingCount = panel.tools.filter((tabId) => workspaceToolKind(tabId) === kind).length;
      const tabId = existingCount === 0 ? kind : `${kind}--${++this.nextTabInstance}`;
      panel.tools.push(tabId);
      panel.visible = true;
      panel.activeTab = tabId;
      return tabId;
    },

    closeTool(sessionId: string, tabId: WorkspaceTabId) {
      const panel = this.panels[sessionId];
      if (!panel || !panel.tools.includes(tabId)) return;

      panel.tools = panel.tools.filter((tool) => tool !== tabId);
      if (panel.returnTab === tabId) {
        panel.returnTab = panel.tools.at(-1) ?? null;
      }

      if (panel.activeTab === tabId) {
        panel.activeTab = panel.preview ? "preview" : panel.tools.at(-1) ?? null;
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
          : panel.tools.at(-1) ?? null;
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
