<script setup lang="ts">
import { computed, onBeforeUnmount, toRaw } from "vue";
import type { Component, ComponentPublicInstance } from "vue";
import { useWorkspaceToolsStore, type WorkspaceToolKind } from "../stores/workspace-tools.js";
import { useI18n } from "../i18n/index.js";

const props = defineProps<{
  sessionId: string;
  projectId: string;
  active: boolean;
  toolComponents: Partial<Record<WorkspaceToolKind, Component>>;
}>();

const store = useWorkspaceToolsStore();
const { t } = useI18n();
const panel = computed(() => store.panels[props.sessionId] ?? null);
const tools = computed(() => panel.value?.tools.filter((kind) => props.toolComponents[kind]) ?? []);
const instances = new Map<WorkspaceToolKind, ComponentPublicInstance & { dispose?: () => void | Promise<void> }>();
const disposed = new WeakSet<object>();
const disposePromises = new Map<WorkspaceToolKind, Promise<void>>();

function getToolComponent(kind: WorkspaceToolKind): Component | undefined {
  const component = props.toolComponents[kind];
  return component ? toRaw(component) : undefined;
}

function setToolRef(kind: WorkspaceToolKind, value: unknown) {
  const instance = value as ComponentPublicInstance | null;
  if (instance) instances.set(kind, instance as ComponentPublicInstance & { dispose?: () => void | Promise<void> });
  else instances.delete(kind);
}

function disposeTool(kind: WorkspaceToolKind): Promise<void> {
  const pending = disposePromises.get(kind);
  if (pending) return pending;

  const instance = instances.get(kind);
  if (!instance || disposed.has(instance)) return Promise.resolve();

  const cleanup = Promise.resolve()
    .then(() => instance.dispose?.())
    .then(() => { disposed.add(instance); });
  const tracked = cleanup.finally(() => {
    if (disposePromises.get(kind) === tracked) disposePromises.delete(kind);
  });
  disposePromises.set(kind, tracked);
  return tracked;
}

async function disposeAll(): Promise<void> {
  await Promise.all([...instances.keys()].map((kind) => disposeTool(kind)));
}

onBeforeUnmount(() => {
  void disposeAll().catch((error) => console.error("Failed to dispose workspace tools:", error));
});

defineExpose({ disposeTool, disposeAll });
</script>

<template>
  <div class="workspace-tool-session-view">
    <div
      v-for="kind in tools"
      :key="`${sessionId}:${kind}`"
      v-show="active && panel?.visible && panel?.activeTab === kind"
      class="workspace-tool-tab-panel"
      :data-tab-panel="kind"
    >
      <component
        :is="getToolComponent(kind)"
        :ref="(instance: unknown) => setToolRef(kind, instance)"
        :session-id="sessionId"
        :project-id="panel?.projectId ?? projectId"
        :active="active && Boolean(panel?.visible && panel?.activeTab === kind)"
      />
    </div>
    <div
      v-if="panel?.preview"
      v-show="active && panel.visible && panel.activeTab === 'preview'"
      class="workspace-tool-tab-panel workspace-tool-preview"
      data-tab-panel="preview"
    >
      <slot name="preview" :target="panel.preview" :project-id="panel.projectId">
        <div class="workspace-tool-preview-placeholder">{{ t("workspaceTools.preview") }}</div>
      </slot>
    </div>
  </div>
</template>

<style scoped>
.workspace-tool-session-view,
.workspace-tool-tab-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.workspace-tool-preview-placeholder {
  display: grid;
  flex: 1;
  place-items: center;
  color: var(--text-muted);
  font-size: 12px;
}
</style>
