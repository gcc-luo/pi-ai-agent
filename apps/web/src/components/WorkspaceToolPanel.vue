<script setup lang="ts">
import { computed, defineComponent, h, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { Component, ComponentPublicInstance } from "vue";
import WorkspaceToolSessionView from "./WorkspaceToolSessionView.vue";
import {
  useWorkspaceToolsStore,
  WORKSPACE_TOOL_KINDS,
  workspaceToolKind,
  type WorkspaceTabId,
  type WorkspaceToolKind,
} from "../stores/workspace-tools.js";
import { useI18n } from "../i18n/index.js";
import { closeNativeWorkspaceToolMenu, openNativeWorkspaceToolMenu } from "../api/native-browser.js";
import { isTauri } from "../utils/platform.js";

const props = withDefaults(defineProps<{
  sessionId: string;
  projectId: string;
  active: boolean;
  width: number;
  isMaximized?: boolean;
  isResizing: boolean;
  toolComponents: Partial<Record<WorkspaceToolKind, Component>>;
  minWidth?: number;
  maxWidth?: number;
}>(), {
  minWidth: 280,
  maxWidth: 960,
  isMaximized: false,
});

const emit = defineEmits<{
  "resize-start": [event: PointerEvent];
  "maximize-toggle": [];
  "close-panel": [];
}>();

const store = useWorkspaceToolsStore();
const { t } = useI18n();
const closeError = ref("");
const addMenu = ref<HTMLDetailsElement | null>(null);
const draggedTab = ref<WorkspaceTabId | null>(null);
const contextMenu = ref<{ tab: WorkspaceTabId; x: number; y: number } | null>(null);
const failedFavicons = ref<Record<WorkspaceTabId, string>>({});
const toolIcons: Record<WorkspaceToolKind, Component> = {
  files: defineComponent({ setup: () => () => h("svg", { viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", "stroke-width": 1.4, "aria-hidden": "true" }, [h("path", { d: "M2 4.5h4l1.4 1.7H14v6.3H2zM2 4.5V3h4l1.4 1.5" })]) }),
  browser: defineComponent({ setup: () => () => h("svg", { viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", "stroke-width": 1.3, "aria-hidden": "true" }, [h("circle", { cx: 8, cy: 8, r: 6 }), h("path", { d: "M2.3 6h11.4M2.3 10h11.4M8 2c1.5 1.6 2.2 3.6 2.2 6S9.5 12.4 8 14M8 2C6.5 3.6 5.8 5.6 5.8 8S6.5 12.4 8 14" })]) }),
  terminal: defineComponent({ setup: () => () => h("svg", { viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", "stroke-width": 1.5, "aria-hidden": "true" }, [h("path", { d: "m3 4 4 4-4 4M9 12h4" })]) }),
};
const panel = computed(() => store.panels[props.sessionId] ?? null);
const registeredTools = computed(() => WORKSPACE_TOOL_KINDS.filter((kind) => props.toolComponents[kind]));
const availableTools = computed(() => registeredTools.value);
const tabs = computed<WorkspaceTabId[]>(() => [
  ...(panel.value?.tools ?? []),
  ...(panel.value?.preview ? ["preview" as const] : []),
]);
const tabLimitReached = computed(() => (panel.value?.tools.length ?? 0) >= 20);
const sessionViewRef = ref<InstanceType<typeof WorkspaceToolSessionView> | null>(null);
let stopNativeMenuListener: (() => void) | undefined;
let stopNativeMenuDismissListener: (() => void) | undefined;
let nativeMenuGeneration = 0;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] ?? character);
}

function nativeMenuHtml(menu: HTMLElement): string {
  const rootStyle = getComputedStyle(document.documentElement);
  const color = (name: string, fallback: string) => (rootStyle.getPropertyValue(name).trim() || fallback)
    .replace(/[^\w\s#(),.%'"-]/g, "");
  const background = color("--bg-elevated", "#fffdf9");
  const icons: Record<WorkspaceToolKind, string> = {
    files: '<svg viewBox="0 0 16 16"><path d="M2 4.5h4l1.4 1.7H14v6.3H2zM2 4.5V3h4l1.4 1.5"/></svg>',
    browser: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/><path d="M2.3 6h11.4M2.3 10h11.4M8 2c1.5 1.6 2.2 3.6 2.2 6S9.5 12.4 8 14M8 2C6.5 3.6 5.8 5.6 5.8 8S6.5 12.4 8 14"/></svg>',
    terminal: '<svg viewBox="0 0 16 16"><path d="m3 4 4 4-4 4M9 12h4"/></svg>',
  };
  const options = availableTools.value.map((kind) =>
    `<a href="pi-tool-menu://${kind}">${icons[kind]}<span>${escapeHtml(t(`workspaceTools.${kind}`))}</span></a>`,
  ).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    *{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;background:transparent}
    body{font-family:${color("--font-sans", "Arial,sans-serif")};font-size:14px;color:${color("--text-secondary", "#333")}}
    .menu{position:absolute;left:10px;top:4px;width:${Math.ceil(menu.getBoundingClientRect().width)}px;padding:8px 6px 6px;border:1px solid ${color("--border-default", "#ddd")};border-radius:12px;background:${background};box-shadow:0 10px 28px rgba(0,0,0,.18)}
    header{height:26px;padding:1px 10px 5px;color:${color("--text-muted", "#858585")};font-size:12px}
    a{display:flex;align-items:center;gap:10px;min-height:40px;padding:0 10px;border-radius:8px;color:${color("--text-primary", "#222")};text-decoration:none;outline:none}
    a:hover,a:focus{background:${color("--bg-hover", "#f2f2ef")}}
    svg{width:16px;height:16px;flex:0 0 auto;fill:none;stroke:currentColor;stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round}
  </style></head><body onkeydown="if(event.key==='Escape')location.href='pi-tool-menu://dismiss'"><div class="menu"><header>${escapeHtml(t("workspaceTools.addTab"))}</header>${options}</div></body></html>`;
}

function closeNativeMenu() {
  if (!isTauri()) return;
  nativeMenuGeneration += 1;
  const menu = addMenu.value?.querySelector<HTMLElement>(".workspace-tool-add-menu");
  if (menu) menu.style.visibility = "";
  void closeNativeWorkspaceToolMenu(props.sessionId).catch(() => undefined);
}

async function onAddMenuToggle() {
  if (!addMenu.value?.open) {
    closeNativeMenu();
    return;
  }
  const menu = addMenu.value.querySelector<HTMLElement>(".workspace-tool-add-menu");
  if (!menu) return;
  const summary = addMenu.value.querySelector("summary");
  if (!summary) return;
  const anchor = summary.getBoundingClientRect();
  const initialRect = menu.getBoundingClientRect();
  const left = Math.max(4, Math.min(anchor.right - initialRect.width, window.innerWidth - initialRect.width - 4));
  const top = anchor.bottom + initialRect.height + 4 > window.innerHeight
    ? Math.max(4, anchor.top - initialRect.height + 2)
    : anchor.bottom - 2;
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  const rect = menu.getBoundingClientRect();
  const activeTab = panel.value?.activeTab;
  if (!isTauri() || !activeTab || workspaceToolKind(activeTab) !== "browser") return;
  const margin = 10;
  const generation = ++nativeMenuGeneration;
  menu.style.visibility = "hidden";
  try {
    await openNativeWorkspaceToolMenu(props.sessionId, {
      x: Math.max(0, rect.left - margin),
      y: Math.max(0, rect.top - 4),
      width: Math.ceil(rect.width + margin * 2),
      height: Math.ceil(rect.height + 8),
    }, nativeMenuHtml(menu));
    if (generation !== nativeMenuGeneration) closeNativeMenu();
  } catch (error) {
    menu.style.visibility = "";
    console.error("Failed to open native workspace tool menu:", error);
  }
}

function openTool(kind: WorkspaceToolKind) {
  closeNativeMenu();
  try {
    store.openTool(props.sessionId, props.projectId, kind);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    closeError.value = t(detail.startsWith("workspaceTools.") ? detail : "workspaceTools.maxTabsReached");
  }
  if (addMenu.value) addMenu.value.open = false;
}

function tabTitle(tab: WorkspaceTabId): string {
  if (tab === "preview") return t("workspaceTools.preview");
  const kind = workspaceToolKind(tab);
  if (!kind) return tab;
  const meta = panel.value?.tabMeta[tab];
  if (meta?.title?.trim()) return meta.title;
  if (kind === "files" && meta?.path) return meta.path.split(/[\\/]/).at(-1) || meta.path;
  if (kind === "browser" && meta?.url && meta.url !== "about:blank") {
    try { return new URL(meta.url).hostname; } catch { /* fall through to numbered label */ }
  }
  const ordinal = (panel.value?.tools ?? [])
    .slice(0, (panel.value?.tools ?? []).indexOf(tab) + 1)
    .filter((candidate) => workspaceToolKind(candidate) === kind).length;
  return `${t(`workspaceTools.${kind}`)}${ordinal > 1 ? ` ${ordinal}` : ""}`;
}

function tabIcon(tab: WorkspaceTabId) {
  const kind = workspaceToolKind(tab);
  return kind ? toolIcons[kind] : toolIcons.files;
}

function onFaviconError(tab: WorkspaceTabId, favicon: string | undefined) {
  if (favicon) failedFavicons.value[tab] = favicon;
}

function onTabDrop(target: WorkspaceTabId) {
  const source = draggedTab.value;
  draggedTab.value = null;
  if (!source || source === target || source === "preview" || target === "preview") return;
  const ordered = [...(panel.value?.tools ?? [])];
  const from = ordered.indexOf(source);
  const to = ordered.indexOf(target);
  if (from < 0 || to < 0) return;
  ordered.splice(from, 1);
  ordered.splice(to, 0, source);
  store.reorderTools(props.sessionId, ordered);
}

function openTabContextMenu(event: MouseEvent, tab: WorkspaceTabId) {
  event.preventDefault();
  contextMenu.value = { tab, x: event.clientX, y: event.clientY };
}

function closeContextMenu() {
  contextMenu.value = null;
}

async function closeOtherTabs() {
  const keep = contextMenu.value?.tab;
  contextMenu.value = null;
  if (!keep || keep === "preview") return;
  for (const tab of [...(panel.value?.tools ?? [])]) {
    if (tab !== keep) await closeTab(tab);
  }
}

async function closeAllTabs() {
  contextMenu.value = null;
  for (const tab of [...(panel.value?.tools ?? [])]) await closeTab(tab);
  if (panel.value?.preview) store.closePreview(props.sessionId);
}

function onGlobalPointerDown(event: PointerEvent) {
  const target = event.target;
  if (target instanceof Element && !target.closest(".workspace-tool-context-menu")) {
    closeContextMenu();
  }
  if (target instanceof Node && !addMenu.value?.contains(target) && addMenu.value) {
    addMenu.value.open = false;
    closeNativeMenu();
  }
}

function onGlobalKeyDown(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  closeContextMenu();
  if (addMenu.value) addMenu.value.open = false;
  closeNativeMenu();
}

onMounted(() => {
  window.addEventListener("pointerdown", onGlobalPointerDown);
  window.addEventListener("keydown", onGlobalKeyDown);
  if (isTauri()) {
    void import("@tauri-apps/api/event").then(({ listen }) => listen<{ sessionId: string; kind: WorkspaceToolKind }>(
      "native-workspace-tool-menu-action",
      (event) => {
        if (event.payload.sessionId === props.sessionId) openTool(event.payload.kind);
      },
    )).then((stop) => {
      if (addMenu.value?.isConnected) stopNativeMenuListener = stop;
      else stop();
    }).catch((error) => console.error("Failed to listen for native workspace menu actions:", error));
    void import("@tauri-apps/api/event").then(({ listen }) => listen<{ sessionId: string }>(
      "native-workspace-tool-menu-dismiss",
      (event) => {
        if (event.payload.sessionId !== props.sessionId) return;
        if (addMenu.value) addMenu.value.open = false;
        closeNativeMenu();
      },
    )).then((stop) => {
      if (addMenu.value?.isConnected) stopNativeMenuDismissListener = stop;
      else stop();
    }).catch((error) => console.error("Failed to listen for native workspace menu dismissal:", error));
  }
});
onBeforeUnmount(() => {
  window.removeEventListener("pointerdown", onGlobalPointerDown);
  window.removeEventListener("keydown", onGlobalKeyDown);
  stopNativeMenuListener?.();
  stopNativeMenuDismissListener?.();
  closeNativeMenu();
});
watch(() => props.active && Boolean(panel.value?.visible), (visible) => {
  if (visible) return;
  if (addMenu.value) addMenu.value.open = false;
  closeNativeMenu();
});

async function closeTab(tab: WorkspaceTabId) {
  closeError.value = "";
  if (tab === "preview") {
    store.closePreview(props.sessionId);
    return;
  }
  try {
    await sessionViewRef.value?.disposeTool(tab);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    closeError.value = `${t("workspaceTools.closeFailed")}: ${detail}`;
    console.error("Failed to close workspace tool:", error);
    return;
  }
  store.closeTool(props.sessionId, tab);
}

function activateTab(tab: WorkspaceTabId) {
  store.setActiveTab(props.sessionId, tab);
}

async function disposeAll(): Promise<void> {
  await sessionViewRef.value?.disposeAll();
}

defineExpose({ disposeAll });
</script>

<template>
  <aside
    v-show="active && panel?.visible"
    class="workspace-tool-panel"
    :style="{ width: `${width}px` }"
    :data-session-id="sessionId"
  >
    <div
      v-if="!isMaximized"
      class="preview-resizer"
      :class="{ active: isResizing }"
      role="separator"
      aria-orientation="vertical"
      :aria-valuemin="minWidth"
      :aria-valuemax="maxWidth"
      :aria-valuenow="width"
      data-test="preview-resizer"
      @pointerdown="emit('resize-start', $event)"
    />

    <div class="workspace-tool-tabs">
      <div v-if="tabs.length" class="workspace-tool-tabs-scroll" role="tablist" data-test="tool-tabs-scroll">
        <div
          v-for="tab in tabs"
          :key="tab"
          class="workspace-tool-tab"
          draggable="true"
          @dragstart="draggedTab = tab"
          @dragend="draggedTab = null"
          @dragover.prevent
          @drop.prevent="onTabDrop(tab)"
          @contextmenu="openTabContextMenu($event, tab)"
        >
          <button
            class="workspace-tool-tab-select"
            :class="{ active: panel?.activeTab === tab }"
            role="tab"
            :aria-selected="panel?.activeTab === tab"
            :data-test="`select-tab-${tab}`"
            @click="activateTab(tab)"
          >
            <img
              v-if="tab !== 'preview' && panel?.tabMeta[tab]?.favicon && failedFavicons[tab] !== panel.tabMeta[tab]?.favicon"
              class="workspace-tool-tab-icon"
              :src="panel.tabMeta[tab]?.favicon"
              alt=""
              @error="onFaviconError(tab, panel.tabMeta[tab]?.favicon)"
            >
            <component v-else :is="tabIcon(tab)" class="workspace-tool-tab-icon" aria-hidden="true" />
            <span class="workspace-tool-tab-title">{{ tabTitle(tab) }}</span>
          </button>
          <button
            class="workspace-tool-tab-close"
            type="button"
            :aria-label="`${t('workspaceTools.closeTab')} ${tabTitle(tab)}`"
            :data-test="`close-tab-${tab}`"
            @click="closeTab(tab)"
          >
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
            </svg>
          </button>
        </div>
        <details v-if="availableTools.length" ref="addMenu" class="workspace-tool-add" data-test="tool-add-menu" @toggle="onAddMenuToggle">
          <summary :aria-label="t('workspaceTools.addTab')" :title="t('workspaceTools.addTab')">+</summary>
          <div class="workspace-tool-add-menu">
            <span class="workspace-tool-add-heading">{{ t("workspaceTools.addTab") }}</span>
            <button
              v-for="kind in availableTools"
              :key="kind"
              type="button"
              data-test="add-tool-option"
              :data-test-option="kind"
              :disabled="tabLimitReached"
              :title="tabLimitReached ? t('workspaceTools.maxTabsReached') : undefined"
              @click="openTool(kind)"
            >
              <component :is="toolIcons[kind]" class="workspace-tool-menu-icon" aria-hidden="true" />
              {{ t(`workspaceTools.${kind}`) }}
            </button>
          </div>
        </details>
      </div>
      <div class="workspace-tool-controls">
        <button
          class="workspace-tool-control"
          type="button"
          :aria-label="t(isMaximized ? 'workspaceTools.restorePanel' : 'workspaceTools.maximizePanel')"
          :title="t(isMaximized ? 'workspaceTools.restorePanel' : 'workspaceTools.maximizePanel')"
          :aria-pressed="isMaximized"
          @click="emit('maximize-toggle')"
        >
          <svg v-if="isMaximized" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="2.5" y="4.5" width="8.5" height="8.5" rx="1.2" stroke="currentColor" stroke-width="1.3" />
            <path d="M5 4.5V3.8c0-.7.6-1.3 1.3-1.3h5.9c.7 0 1.3.6 1.3 1.3v5.9c0 .7-.6 1.3-1.3 1.3h-.7" stroke="currentColor" stroke-width="1.3" />
          </svg>
          <svg v-else width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M5.5 2.5H3.8c-.7 0-1.3.6-1.3 1.3v1.7M10.5 2.5h1.7c.7 0 1.3.6 1.3 1.3v1.7M13.5 10.5v1.7c0 .7-.6 1.3-1.3 1.3h-1.7M5.5 13.5H3.8c-.7 0-1.3-.6-1.3-1.3v-1.7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
          </svg>
        </button>
        <button
          class="workspace-tool-control"
          type="button"
          :aria-label="t('workspaceTools.closePanel')"
          :title="t('workspaceTools.closePanel')"
          @click="closeNativeMenu(); emit('close-panel')"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M6 3H3v10h3M9 5l3 3-3 3M12 8H6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
      </div>
    </div>

    <div v-if="!tabs.length" class="workspace-tool-empty">
      <div class="workspace-tool-empty-heading">
        <span>{{ t("workspaceTools.empty") }}</span>
        <h2>{{ t("workspaceTools.emptyTitle") }}</h2>
        <p>{{ t("workspaceTools.emptyDescription") }}</p>
      </div>
      <button
        v-for="kind in registeredTools"
        :key="kind"
        type="button"
        data-test="empty-tool"
        @click="openTool(kind)"
      >
        <component :is="toolIcons[kind]" class="workspace-tool-menu-icon" aria-hidden="true" />
        <span class="workspace-tool-empty-copy">
          <strong>{{ t(`workspaceTools.${kind}`) }}</strong>
          <small>{{ t(`workspaceTools.${kind}Description`) }}</small>
        </span>
        <span class="workspace-tool-empty-chevron" aria-hidden="true">›</span>
      </button>
    </div>

    <div v-if="closeError" class="workspace-tool-close-error" role="alert">{{ closeError }}</div>

    <div
      v-if="contextMenu"
      class="workspace-tool-context-menu"
      :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
      role="menu"
      @pointerdown.stop
    >
      <button type="button" role="menuitem" @click="closeOtherTabs">{{ t("workspaceTools.closeOtherTabs") }}</button>
      <button type="button" role="menuitem" @click="closeAllTabs">{{ t("workspaceTools.closeAllTabs") }}</button>
    </div>

    <WorkspaceToolSessionView
      v-if="panel"
      ref="sessionViewRef"
      class="workspace-tool-content"
      :session-id="sessionId"
      :project-id="panel.projectId"
      :active="active"
      :tool-components="toolComponents"
    >
      <template #preview="slotProps">
        <slot name="preview" v-bind="slotProps" />
      </template>
    </WorkspaceToolSessionView>
  </aside>
</template>

<style scoped>
.workspace-tool-panel {
  position: relative;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  border-left: 1px solid var(--border-default);
  background: var(--bg-deep);
  box-shadow: -1px 0 var(--border-subtle);
}

.preview-resizer {
  position: absolute;
  z-index: 2;
  top: 0;
  bottom: 0;
  left: -3px;
  width: 6px;
  cursor: col-resize;
  touch-action: none;
}

.preview-resizer::after {
  position: absolute;
  inset: 0 2px;
  content: "";
  background: transparent;
  transition: background var(--transition-fast);
}

.preview-resizer:hover::after,
.preview-resizer.active::after {
  background: var(--accent);
}

.workspace-tool-tabs {
  position: relative;
  z-index: 4;
  display: flex;
  align-items: stretch;
  min-height: 36px;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
  overflow: visible;
}

.workspace-tool-controls {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 2px;
  padding: 0 6px;
}

.workspace-tool-control {
  display: grid;
  width: 28px;
  height: 28px;
  padding: 0;
  place-items: center;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.workspace-tool-control:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.workspace-tool-tabs-scroll {
  display: flex;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
}

.workspace-tool-tab {
  display: flex;
  align-items: center;
  border-right: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.workspace-tool-tab-select,
.workspace-tool-tab-close,
.workspace-tool-add summary {
  display: flex;
  align-items: center;
  justify-content: center;
  border: 0;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.workspace-tool-tab-select {
  display: flex;
  align-items: center;
  gap: 7px;
  max-width: 220px;
  min-height: 35px;
  padding: 0 10px;
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 500;
}

.workspace-tool-tab-icon,
.workspace-tool-menu-icon {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
}

.workspace-tool-tab-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workspace-tool-tab-select.active {
  color: var(--text-primary);
  box-shadow: inset 0 -2px var(--accent);
}

.workspace-tool-tab-close {
  width: 22px;
  height: 22px;
  border-radius: var(--radius-sm);
  opacity: 0;
  transition: opacity var(--transition-fast);
}

.workspace-tool-tab:hover .workspace-tool-tab-close,
.workspace-tool-tab:focus-within .workspace-tool-tab-close {
  opacity: 1;
}

.workspace-tool-tab-close:hover,
.workspace-tool-tab-select:hover,
.workspace-tool-add summary:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}

.workspace-tool-add {
  position: relative;
  z-index: 1;
  display: flex;
  flex: 0 0 38px;
  align-items: center;
  padding: 0 6px;
}

.workspace-tool-add summary {
  width: 26px;
  height: 26px;
  border-radius: var(--radius-sm);
  font-size: 18px;
  list-style: none;
}

.workspace-tool-add summary::-webkit-details-marker {
  display: none;
}

.workspace-tool-add-menu {
  position: fixed;
  z-index: 1000;
  top: 0;
  left: 0;
  display: grid;
  min-width: 196px;
  padding: 8px 6px 6px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.24);
}

.workspace-tool-add-heading {
  display: block;
  height: 26px;
  padding: 1px 10px 5px;
  color: var(--text-muted);
  font-size: 12px;
}

.workspace-tool-context-menu {
  position: fixed;
  z-index: 20;
  display: grid;
  min-width: 150px;
  padding: 4px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.24);
}

.workspace-tool-context-menu button {
  padding: 8px 10px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  text-align: left;
  cursor: pointer;
}

.workspace-tool-context-menu button:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.workspace-tool-add-menu button,
.workspace-tool-empty button {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 10px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  text-align: left;
  cursor: pointer;
}

.workspace-tool-add-menu button { min-height: 40px; }

.workspace-tool-add-menu button:hover,
.workspace-tool-empty button:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.workspace-tool-add-menu button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.workspace-tool-empty {
  display: flex;
  flex-direction: column;
  margin: 36px 24px 0;
  min-height: 0;
  color: var(--text-secondary);
  font-size: 13px;
}

.workspace-tool-empty-heading {
  margin: 0 0 22px;
}

.workspace-tool-empty-heading > span {
  color: var(--text-muted);
  font-size: 12px;
}

.workspace-tool-empty-heading h2 {
  margin: 8px 0;
  color: var(--text-primary);
  font-size: 19px;
  font-weight: 600;
}

.workspace-tool-empty-heading p {
  max-width: 420px;
  margin: 0;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.55;
}

.workspace-tool-empty button {
  min-height: 76px;
  padding: 12px 8px;
  border-bottom: 1px solid var(--border-subtle);
  border-radius: 0;
}

.workspace-tool-empty-copy {
  display: grid;
  flex: 1;
  gap: 4px;
}

.workspace-tool-empty-copy strong {
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 500;
}

.workspace-tool-empty-copy small {
  color: var(--text-muted);
  font-size: 12px;
}

.workspace-tool-empty-chevron {
  color: var(--text-muted);
  font-size: 20px;
}

.workspace-tool-close-error {
  flex-shrink: 0;
  padding: 6px 10px;
  color: var(--rose);
  font-size: 11px;
}

.workspace-tool-content {
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.workspace-tool-content:empty {
  display: none;
}
</style>
