<script setup lang="ts">
import { computed, onBeforeUnmount, toRaw } from "vue";
import type { Component, ComponentPublicInstance } from "vue";
import { useWorkspaceToolsStore, workspaceToolKind, type WorkspaceTabId, type WorkspaceToolKind } from "../stores/workspace-tools.js";
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
const tools = computed(() => (panel.value?.tools ?? [])
  .map((id) => ({ id, kind: workspaceToolKind(id) }))
  .filter((tab): tab is { id: WorkspaceTabId; kind: WorkspaceToolKind } =>
    Boolean(tab.kind && props.toolComponents[tab.kind])));
const instances = new Map<WorkspaceTabId, ComponentPublicInstance & { dispose?: () => void | Promise<void> }>();
const disposed = new WeakSet<object>();
const disposePromises = new Map<WorkspaceTabId, Promise<void>>();

function getToolComponent(kind: NonNullable<ReturnType<typeof workspaceToolKind>>): Component | undefined {
  const component = props.toolComponents[kind];
  return component ? toRaw(component) : undefined;
}

function setToolRef(kind: WorkspaceTabId, value: unknown) {
  const instance = value as ComponentPublicInstance | null;
  if (instance) instances.set(kind, instance as ComponentPublicInstance & { dispose?: () => void | Promise<void> });
  else instances.delete(kind);
}

function disposeTool(kind: WorkspaceTabId): Promise<void> {
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
  const results = await Promise.allSettled([...instances.keys()].map((kind) => disposeTool(kind)));
  const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failed) throw failed.reason;
}

onBeforeUnmount(() => {
  void disposeAll().catch((error) => console.error("Failed to dispose workspace tools:", error));
});

defineExpose({ disposeTool, disposeAll });
</script>

<template>
  <div class="workspace-tool-session-view">
    <div
      v-for="tool in tools"
      :key="`${sessionId}:${tool.id}`"
      v-show="active && panel?.visible && panel?.activeTab === tool.id"
      class="workspace-tool-tab-panel"
      :data-tab-panel="tool.id"
    >
      <component
        :is="getToolComponent(tool.kind)"
        :ref="(instance: unknown) => setToolRef(tool.id, instance)"
        :session-id="sessionId"
        :instance-id="tool.id"
        :project-id="panel?.projectId ?? projectId"
        :active="active && Boolean(panel?.visible && panel?.activeTab === tool.id)"
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
