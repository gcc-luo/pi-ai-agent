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
  /** Browser URL / page title per tab, persisted independently like Cindy tab state. */
  tabMeta: Record<WorkspaceTabId, { url?: string; title?: string; favicon?: string; path?: string | null }>;
}

const STORAGE_KEY = "pi-web-ui:workspace-tool-panels:v1";
const MAX_TABS_PER_SESSION = 20;

function readPersistedPanels(): Record<string, WorkspaceSessionPanel> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, Partial<WorkspaceSessionPanel>>;
    const panels: Record<string, WorkspaceSessionPanel> = {};
    for (const [sessionId, candidate] of Object.entries(parsed)) {
      const tools = Array.isArray(candidate.tools)
        ? candidate.tools.filter((tab): tab is string => typeof tab === "string" && workspaceToolKind(tab) !== null).slice(0, MAX_TABS_PER_SESSION)
        : [];
      const activeTab = typeof candidate.activeTab === "string"
        && (candidate.activeTab === "preview" || tools.includes(candidate.activeTab))
        ? candidate.activeTab
        : tools.at(-1) ?? null;
      panels[sessionId] = {
        projectId: typeof candidate.projectId === "string" ? candidate.projectId : "",
        visible: typeof candidate.visible === "boolean" ? candidate.visible : tools.length > 0,
        tools,
        activeTab,
        returnTab: null,
        preview: null,
        tabMeta: candidate.tabMeta && typeof candidate.tabMeta === "object" ? candidate.tabMeta : {},
      };
    }
    return panels;
  } catch {
    return {};
  }
}

function persistPanels(panels: Record<string, WorkspaceSessionPanel>) {
  if (typeof localStorage === "undefined") return;
  try {
    const persisted = Object.fromEntries(Object.entries(panels).map(([sessionId, panel]) => [sessionId, {
      projectId: panel.projectId,
      visible: panel.visible,
      tools: panel.tools,
      activeTab: panel.activeTab === "preview" ? null : panel.activeTab,
      tabMeta: panel.tabMeta,
    }]));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
  } catch (error) {
    console.warn("Could not persist workspace tool tabs:", error);
  }
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
    panels: readPersistedPanels(),
  }),
  actions: {
    ensurePanel(sessionId: string, projectId: string): WorkspaceSessionPanel {
      const panel = this.panels[sessionId] ??= {
        projectId,
        visible: false,
        tools: [],
        activeTab: null,
        returnTab: null,
        preview: null,
        tabMeta: {},
      };
      panel.projectId = projectId;
      return panel;
    },

    togglePanel(sessionId: string, projectId: string) {
      const panel = this.ensurePanel(sessionId, projectId);
      panel.visible = !panel.visible;
      persistPanels(this.panels);
    },

    openTool(sessionId: string, projectId: string, kind: WorkspaceToolKind): WorkspaceTabId {
      const panel = this.ensurePanel(sessionId, projectId);
      if (panel.tools.length >= MAX_TABS_PER_SESSION) {
        throw new Error("workspaceTools.maxTabsReached");
      }
      const tabId = `${kind}--${crypto.randomUUID()}`;
      panel.tools.push(tabId);
      panel.tabMeta[tabId] = kind === "browser" ? { url: "about:blank" } : {};
      panel.visible = true;
      panel.activeTab = tabId;
      persistPanels(this.panels);
      return tabId;
    },

    closeTool(sessionId: string, tabId: WorkspaceTabId) {
      const panel = this.panels[sessionId];
      if (!panel || !panel.tools.includes(tabId)) return;

      const closedIndex = panel.tools.indexOf(tabId);
      panel.tools = panel.tools.filter((tool) => tool !== tabId);
      delete panel.tabMeta[tabId];
      if (panel.returnTab === tabId) {
        panel.returnTab = panel.tools.at(-1) ?? null;
      }

      if (panel.activeTab === tabId) {
        panel.activeTab = panel.preview
          ? "preview"
          : panel.tools[closedIndex] ?? panel.tools[closedIndex - 1] ?? null;
      }

      if (!panel.tools.length && !panel.preview) {
        panel.visible = false;
        panel.activeTab = null;
        panel.returnTab = null;
      }
      persistPanels(this.panels);
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
      persistPanels(this.panels);
    },

    setActiveTab(sessionId: string, tab: WorkspaceTabId) {
      const panel = this.panels[sessionId];
      if (!panel) return;
      if (tab === "preview" ? !panel.preview : !panel.tools.includes(tab)) return;
      panel.activeTab = tab;
      panel.visible = true;
      persistPanels(this.panels);
    },

    reorderTools(sessionId: string, orderedIds: WorkspaceTabId[]) {
      const panel = this.panels[sessionId];
      if (!panel) return;
      const next = orderedIds.filter((id) => panel.tools.includes(id));
      for (const id of panel.tools) if (!next.includes(id)) next.push(id);
      panel.tools = next;
      persistPanels(this.panels);
    },

    updateToolMeta(sessionId: string, tabId: WorkspaceTabId, patch: { url?: string; title?: string; favicon?: string; path?: string | null }) {
      const panel = this.panels[sessionId];
      if (!panel?.tools.includes(tabId)) return;
      panel.tabMeta[tabId] = { ...panel.tabMeta[tabId], ...patch };
      persistPanels(this.panels);
    },

    removeSession(sessionId: string) {
      delete this.panels[sessionId];
      persistPanels(this.panels);
    },
  },
});
