<script setup lang="ts">
import { computed, onBeforeUnmount, toRaw } from "vue";
import type { Component, ComponentPublicInstance } from "vue";
import { useWorkspaceToolsStore, type WorkspaceToolKind } from "../stores/workspace-tools.js";
import { useI18n } from "../i18n/index.js";

const props = defineProps<{
  sessionId: string;
  projectId: string;
  toolComponents: Partial<Record<WorkspaceToolKind, Component>>;
}>();

const store = useWorkspaceToolsStore();
const { t } = useI18n();
const panel = computed(() => store.panels[props.sessionId] ?? null);
const tools = computed(() => panel.value?.tools.filter((kind) => props.toolComponents[kind]) ?? []);
const instances = new Map<WorkspaceToolKind, ComponentPublicInstance & { dispose?: () => void }>();
const disposed = new WeakSet<object>();

function getToolComponent(kind: WorkspaceToolKind): Component | undefined {
  const component = props.toolComponents[kind];
  return component ? toRaw(component) : undefined;
}

function setToolRef(kind: WorkspaceToolKind, value: unknown) {
  const instance = value as ComponentPublicInstance | null;
  if (instance) instances.set(kind, instance as ComponentPublicInstance & { dispose?: () => void });
  else instances.delete(kind);
}

function disposeTool(kind: WorkspaceToolKind) {
  const instance = instances.get(kind);
  if (!instance || disposed.has(instance)) return;
  disposed.add(instance);
  instance.dispose?.();
}

function disposeAll() {
  for (const kind of instances.keys()) disposeTool(kind);
}

onBeforeUnmount(disposeAll);

defineExpose({ disposeTool, disposeAll });
</script>

<template>
  <div class="workspace-tool-session-view">
    <div
      v-for="kind in tools"
      :key="`${sessionId}:${kind}`"
      v-show="panel?.activeTab === kind"
      class="workspace-tool-tab-panel"
      :data-tab-panel="kind"
    >
      <component
        :is="getToolComponent(kind)"
        :ref="(instance: unknown) => setToolRef(kind, instance)"
        :session-id="sessionId"
        :project-id="panel?.projectId ?? projectId"
      />
    </div>
    <div
      v-if="panel?.preview"
      v-show="panel.activeTab === 'preview'"
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
