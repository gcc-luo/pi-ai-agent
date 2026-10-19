<script setup lang="ts">
import { ref, watch } from "vue";
import FileTree from "./FileTree.vue";
import FileViewer from "./FileViewer.vue";
import { useI18n } from "../i18n/index.js";

const props = defineProps<{ projectId: string }>();
const { t } = useI18n();

const fileTreeRef = ref<InstanceType<typeof FileTree> | null>(null);
const selectedPath = ref<string | null>(null);
const listError = ref("");
const reloadKey = ref(0);

function onListError(message: string) {
  listError.value = message;
}

function onListSuccess() {
  listError.value = "";
}

async function retryList() {
  listError.value = "";
  await fileTreeRef.value?.refresh();
}

async function refreshFiles() {
  reloadKey.value++;
  await retryList();
}

watch(() => props.projectId, () => {
  selectedPath.value = null;
  listError.value = "";
  reloadKey.value++;
});

defineExpose({ refresh: refreshFiles });
</script>

<template>
  <section class="workspace-file-browser" data-test="workspace-file-browser">
    <header class="file-browser-header">
      <span class="file-browser-title">{{ t('workspaceTools.files') }}</span>
      <button
        class="file-browser-refresh"
        type="button"
        data-test="refresh-files"
        :title="t('workspaceTools.refreshFiles')"
        :aria-label="t('workspaceTools.refreshFiles')"
        @click="refreshFiles"
      >
        <span aria-hidden="true">↻</span>
      </button>
    </header>

    <div class="workspace-file-browser-body">
      <aside class="file-browser-tree-pane">
        <div v-if="listError" class="file-browser-error" role="alert">
          <span>{{ listError }}</span>
          <button type="button" data-test="retry-file-list" @click="retryList">
            {{ t('chat.retry') }}
          </button>
        </div>
        <FileTree
          ref="fileTreeRef"
          :project-id="projectId"
          :read-only="true"
          @select-file="selectedPath = $event"
          @load-error="onListError"
          @load-success="onListSuccess"
        />
      </aside>
      <div class="file-browser-preview-pane">
        <FileViewer
          :key="`${projectId}:${reloadKey}`"
          :project-id="projectId"
          :path="selectedPath"
          :reload-key="reloadKey"
          hide-header
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
.workspace-file-browser {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  container-type: inline-size;
  background: var(--bg-deep);
}

.file-browser-header {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  min-height: 38px;
  padding: 0 10px 0 14px;
  border-bottom: 1px solid var(--border-subtle);
}

.file-browser-title {
  overflow: hidden;
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-browser-refresh {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  font-size: 19px;
  line-height: 1;
  cursor: pointer;
}

.file-browser-refresh:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.workspace-file-browser-body {
  display: grid;
  flex: 1;
  min-width: 0;
  min-height: 0;
  grid-template-columns: minmax(140px, 34%) minmax(0, 1fr);
  overflow: hidden;
}

.file-browser-tree-pane {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  border-right: 1px solid var(--border-subtle);
}

.file-browser-tree-pane :deep(.file-tree) {
  min-height: 0;
}

.file-browser-preview-pane {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.file-browser-error {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-subtle);
  color: var(--rose);
  font-size: 11px;
  overflow-wrap: anywhere;
}

.file-browser-error button {
  padding: 4px 8px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.file-browser-error button:hover {
  border-color: var(--accent);
  color: var(--text-primary);
}

@container (max-width: 480px) {
  .workspace-file-browser-body {
    display: flex;
    flex-direction: column;
  }

  .file-browser-tree-pane {
    flex: 0 0 42%;
    min-height: 120px;
    border-right: 0;
    border-bottom: 1px solid var(--border-subtle);
  }

  .file-browser-preview-pane {
    flex: 1;
  }
}
</style>
