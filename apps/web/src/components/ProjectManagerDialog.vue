<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { NModal, NInput } from "naive-ui";
import { api } from "../api/client.js";
import { useProjectStore } from "../stores/project.js";
import { useI18n } from "../i18n/index.js";
import type { ProjectDto } from "@pi-web-ui/shared";
import NewProjectDialog from "./NewProjectDialog.vue";
import RenameProjectDialog from "./RenameProjectDialog.vue";
import ConfirmDialog from "./ConfirmDialog.vue";

const props = defineProps<{ show: boolean }>();
const emit = defineEmits<{
  (e: "close"): void;
  (e: "select", id: string): void;
}>();

const { t } = useI18n();
const projectStore = useProjectStore();

const query = ref("");
const renameTarget = ref<ProjectDto | null>(null);
const deleteTarget = ref<ProjectDto | null>(null);
const showNewProject = ref(false);

const filteredProjects = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return projectStore.projects;
  return projectStore.projects.filter(
    (p) => p.name.toLowerCase().includes(q) || p.workdir.toLowerCase().includes(q),
  );
});

watch(() => props.show, (visible) => {
  if (visible) {
    query.value = "";
    renameTarget.value = null;
    deleteTarget.value = null;
  }
});

function handleCreate(name: string, workdir: string) {
  api.createProject(name, workdir).then(async () => {
    await projectStore.loadAll();
    showNewProject.value = false;
  });
}

function handleRename(id: string, name: string) {
  api.updateProject(id, name).then(async () => {
    await projectStore.loadAll();
    renameTarget.value = null;
  });
}

function handleDelete(id: string) {
  api.deleteProject(id).then(async () => {
    await projectStore.loadAll();
    deleteTarget.value = null;
  });
}
</script>

<template>
  <NModal :show="show" @update:show="emit('close')">
    <div class="dialog" @click.stop>
      <div class="dialog-header">
        <h3 class="dialog-title">{{ t('sidebar.manageProjects') }}</h3>
        <button class="dialog-close" @click="emit('close')">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
          </svg>
        </button>
      </div>

      <div class="dialog-toolbar">
        <div class="toolbar-search">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="6" cy="6" r="4" stroke="currentColor" stroke-width="1.2" />
            <path d="M9 9l3.5 3.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
          </svg>
          <NInput
            v-model:value="query"
            size="small"
            :placeholder="t('sidebar.searchProjects')"
          />
        </div>
        <button class="toolbar-create" @click="showNewProject = true">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 2v10M2 7h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
          <span>{{ t('sidebar.newProject') }}</span>
        </button>
      </div>

      <div class="project-list">
        <div v-if="!filteredProjects.length" class="project-empty">
          {{ query ? t('sidebar.noResults') : t('sidebar.noProjects') }}
        </div>
        <div
          v-for="p in filteredProjects"
          :key="p.id"
          class="project-item"
        >
          <div class="project-item-info">
            <svg width="16" height="16" viewBox="0 0 14 14" fill="none">
              <path d="M1.5 3a1 1 0 011-1h3.586a1 1 0 01.707.293l1.414 1.414a1 1 0 00.707.293h3.586a1 1 0 011 1V11a1 1 0 01-1 1h-9a1 1 0 01-1-1V3z" stroke="currentColor" stroke-width="1.2" />
            </svg>
            <div class="project-item-text">
              <span class="project-item-name">{{ p.name }}</span>
              <span class="project-item-path">{{ p.workdir }}</span>
            </div>
          </div>
          <div class="project-item-actions">
            <button class="item-action" :title="t('rename.title')" @click="renameTarget = p">
              <svg width="14" height="14" viewBox="0 0 12 12" fill="none">
                <path d="M2 10l1-3 5-5 2 2-5 5-3 1z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" />
              </svg>
            </button>
            <button class="item-action danger" :title="t('delete.confirmTitle')" @click="deleteTarget = p">
              <svg width="14" height="14" viewBox="0 0 12 12" fill="none">
                <path d="M3 3v7a1 1 0 001 1h4a1 1 0 001-1V3M2 3h8M5 3V2h2v1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <div class="dialog-footer">
        <span class="dialog-count">{{ filteredProjects.length }} {{ t('sidebar.projects') }}</span>
        <button class="btn-close" @click="emit('close')">{{ t('common.close') }}</button>
      </div>
    </div>
  </NModal>

  <NewProjectDialog
    :show="showNewProject"
    @close="showNewProject = false"
    @create="handleCreate"
  />
  <RenameProjectDialog
    :show="renameTarget !== null"
    :project="renameTarget"
    @close="renameTarget = null"
    @rename="handleRename"
  />
  <ConfirmDialog
    :show="deleteTarget !== null"
    :title="t('delete.confirmTitle')"
    :message="t('delete.confirmMessage')"
    :confirm-label="t('delete.confirm')"
    :cancel-label="t('delete.cancel')"
    :danger="true"
    @close="deleteTarget = null"
    @confirm="handleDelete(deleteTarget!.id)"
  />
</template>

<style scoped>
.dialog {
  width: 560px;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-deep);
  border: 1px solid var(--border-default);
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 12px;
  flex-shrink: 0;
}

.dialog-title {
  font-family: var(--font-mono);
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.dialog-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
}
.dialog-close:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.dialog-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 20px 12px;
  flex-shrink: 0;
}

.toolbar-search {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  color: var(--text-muted);
}
.toolbar-search :deep(.n-input) {
  --n-border: none !important;
  --n-border-hover: none !important;
  --n-border-focus: none !important;
  --n-background: transparent !important;
}

.toolbar-create {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 14px;
  height: 30px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--transition-fast);
  flex-shrink: 0;
}
.toolbar-create:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-dim);
}

.project-list {
  flex: 1;
  overflow-y: auto;
  border-top: 1px solid var(--border-subtle);
  min-height: 120px;
  max-height: 400px;
}

.project-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 120px;
  font-size: 13px;
  color: var(--text-faint);
}

.project-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 20px;
  border-bottom: 1px solid var(--border-subtle);
  transition: background var(--transition-fast);
}
.project-item:last-child {
  border-bottom: none;
}
.project-item:hover {
  background: var(--bg-hover);
}
.project-item:hover .project-item-actions {
  opacity: 1;
}

.project-item-info {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1;
  color: var(--text-secondary);
}

.project-item-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.project-item-name {
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-item-path {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-item-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity var(--transition-fast);
}

.item-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
}
.item-action:hover {
  background: var(--bg-elevated);
  color: var(--text-primary);
}
.item-action.danger:hover {
  background: var(--rose-dim, rgba(244, 63, 94, 0.15));
  color: var(--rose);
}

.dialog-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  border-top: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.dialog-count {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-faint);
}

.btn-close {
  padding: 7px 18px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--transition-fast);
}
.btn-close:hover {
  border-color: var(--text-muted);
  color: var(--text-primary);
}
</style>
