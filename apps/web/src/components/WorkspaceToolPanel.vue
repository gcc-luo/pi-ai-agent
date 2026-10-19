<script setup lang="ts">
import { computed, ref } from "vue";
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

const props = withDefaults(defineProps<{
  sessionId: string;
  projectId: string;
  active: boolean;
  width: number;
  isResizing: boolean;
  toolComponents: Partial<Record<WorkspaceToolKind, Component>>;
  minWidth?: number;
  maxWidth?: number;
}>(), {
  minWidth: 280,
  maxWidth: 960,
});

const emit = defineEmits<{
  "resize-start": [event: PointerEvent];
}>();

const store = useWorkspaceToolsStore();
const { t } = useI18n();
const closeError = ref("");
const panel = computed(() => store.panels[props.sessionId] ?? null);
const registeredTools = computed(() => WORKSPACE_TOOL_KINDS.filter((kind) => props.toolComponents[kind]));
const availableTools = computed(() => registeredTools.value);
const tabs = computed<WorkspaceTabId[]>(() => [
  ...(panel.value?.tools ?? []),
  ...(panel.value?.preview ? ["preview" as const] : []),
]);
const sessionViewRef = ref<InstanceType<typeof WorkspaceToolSessionView> | null>(null);

function openTool(kind: WorkspaceToolKind) {
  store.openTool(props.sessionId, props.projectId, kind);
}

function tabTitle(tab: WorkspaceTabId): string {
  if (tab === "preview") return t("workspaceTools.preview");
  const kind = workspaceToolKind(tab);
  if (!kind) return tab;
  const ordinal = (panel.value?.tools ?? [])
    .slice(0, (panel.value?.tools ?? []).indexOf(tab) + 1)
    .filter((candidate) => workspaceToolKind(candidate) === kind).length;
  return `${t(`workspaceTools.${kind}`)}${ordinal > 1 ? ` ${ordinal}` : ""}`;
}

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

    <div v-if="tabs.length" class="workspace-tool-tabs" role="tablist">
      <div class="workspace-tool-tabs-scroll" data-test="tool-tabs-scroll">
        <div v-for="tab in tabs" :key="tab" class="workspace-tool-tab">
          <button
            class="workspace-tool-tab-select"
            :class="{ active: panel?.activeTab === tab }"
            role="tab"
            :aria-selected="panel?.activeTab === tab"
            :data-test="`select-tab-${tab}`"
            @click="activateTab(tab)"
          >
            {{ tabTitle(tab) }}
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
      </div>
      <details v-if="availableTools.length" class="workspace-tool-add" data-test="tool-add-menu">
        <summary :aria-label="t('workspaceTools.addTab')" :title="t('workspaceTools.addTab')">+</summary>
        <div class="workspace-tool-add-menu">
          <button
            v-for="kind in availableTools"
            :key="kind"
            type="button"
            data-test="add-tool-option"
            :data-test-option="kind"
            @click="openTool(kind)"
          >
            {{ t(`workspaceTools.${kind}`) }}
          </button>
        </div>
      </details>
    </div>

    <div v-else class="workspace-tool-empty">
      <p>{{ t("workspaceTools.empty") }}</p>
      <button
        v-for="kind in registeredTools"
        :key="kind"
        type="button"
        data-test="empty-tool"
        @click="openTool(kind)"
      >
        {{ t(`workspaceTools.${kind}`) }}
      </button>
    </div>

    <div v-if="closeError" class="workspace-tool-close-error" role="alert">{{ closeError }}</div>

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
  box-shadow: -4px 0 24px rgba(0, 0, 0, 0.25);
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
  min-height: 38px;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
  overflow: visible;
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
  min-height: 37px;
  padding: 0 10px;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
}

.workspace-tool-tab-select.active {
  color: var(--text-primary);
  box-shadow: inset 0 -2px var(--accent);
}

.workspace-tool-tab-close {
  width: 24px;
  height: 24px;
  border-radius: var(--radius-sm);
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
  position: absolute;
  z-index: 3;
  top: calc(100% - 2px);
  right: 4px;
  display: grid;
  min-width: 140px;
  padding: 4px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.24);
}

.workspace-tool-add-menu button,
.workspace-tool-empty button {
  padding: 8px 10px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  text-align: left;
  cursor: pointer;
}

.workspace-tool-add-menu button:hover,
.workspace-tool-empty button:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.workspace-tool-empty {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 0;
  color: var(--text-muted);
  font-size: 12px;
}

.workspace-tool-empty p {
  margin: 0 0 6px;
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
