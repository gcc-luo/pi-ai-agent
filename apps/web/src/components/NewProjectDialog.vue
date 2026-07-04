<script setup lang="ts">
import { ref, watch } from "vue";
import { NModal, NInput } from "naive-ui";
import { api } from "../api/client.js";
import { useI18n } from "../i18n/index.js";

const props = defineProps<{ show: boolean }>();
const emit = defineEmits<{
  (e: "close"): void;
  (e: "create", name: string, workdir: string): void;
}>();

const { t } = useI18n();

const currentPath = ref("");
const parentPath = ref("");
const directories = ref<{ name: string; path: string }[]>([]);
const selectedPath = ref<string | null>(null);
const projectName = ref("");
const loading = ref(false);
const manualPath = ref("");

watch(
  () => props.show,
  async (visible) => {
    if (!visible) return;
    projectName.value = "";
    selectedPath.value = null;
    manualPath.value = "";
    await navigateTo();
  },
);

async function navigateTo(dirPath?: string) {
  loading.value = true;
  try {
    const res = await api.browseDir(dirPath);
    currentPath.value = res.currentPath;
    parentPath.value = res.parentPath;
    directories.value = res.directories;
    selectedPath.value = null;
    manualPath.value = "";
  } catch {
    // path not found, keep current
  } finally {
    loading.value = false;
  }
}

function selectDir(dir: { name: string; path: string }) {
  selectedPath.value = dir.path;
  projectName.value = dir.name;
}

function goUp() {
  navigateTo(parentPath.value);
}

function goInto(dir: { name: string; path: string }) {
  navigateTo(dir.path);
}

function useManualPath() {
  if (!manualPath.value.trim()) return;
  navigateTo(manualPath.value.trim());
}

function handleCreate() {
  const workdir = selectedPath.value ?? currentPath.value;
  const name = projectName.value.trim() || workdir.split("/").pop() || "Untitled";
  if (!workdir) return;
  emit("create", name, workdir);
  emit("close");
}
</script>

<template>
  <NModal :show="show" @update:show="emit('close')">
    <div class="dialog" @click.stop>
      <!-- Header -->
      <div class="dialog-header">
        <h3 class="dialog-title">{{ t('newProject.title') }}</h3>
        <button class="dialog-close" @click="emit('close')">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
          </svg>
        </button>
      </div>

      <!-- Path bar -->
      <div class="path-bar">
        <div class="path-crumb" @click="goUp" :title="parentPath">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M8 3L4 7l4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </div>
        <div class="path-display" :title="currentPath">{{ currentPath }}</div>
        <div class="path-select" v-if="selectedPath" @click="selectedPath = null; projectName = ''">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
          </svg>
        </div>
      </div>

      <!-- Directory list -->
      <div class="dir-list">
        <div v-if="loading" class="dir-loading">{{ t('newProject.loading') }}</div>
        <template v-else>
          <div
            v-for="d in directories"
            :key="d.path"
            class="dir-item"
            :class="{ selected: d.path === selectedPath }"
            @click="selectDir(d)"
            @dblclick="goInto(d)"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M2 4a1 1 0 011-1h3.586a1 1 0 01.707.293l1.414 1.414a1 1 0 00.707.293H13a1 1 0 011 1V12a1 1 0 01-1 1H3a1 1 0 01-1-1V4z"
                stroke="currentColor"
                stroke-width="1.2"
              />
            </svg>
            <span class="dir-name">{{ d.name }}</span>
            <span class="dir-enter" @click.stop="goInto(d)" :title="t('newProject.open')">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M4 2l4 4-4 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </span>
          </div>
          <div v-if="!directories.length" class="dir-empty">{{ t('newProject.empty') }}</div>
        </template>
      </div>

      <!-- Manual path -->
      <div class="manual-row">
        <NInput
          v-model:value="manualPath"
          size="small"
          :placeholder="t('newProject.manualPath')"
          @keydown.enter="useManualPath"
        />
        <button class="manual-go" @click="useManualPath">{{ t('newProject.go') }}</button>
      </div>

      <!-- Project name -->
      <div class="name-row">
        <label class="name-label">{{ t('newProject.name') }}</label>
        <NInput
          v-model:value="projectName"
          size="small"
          :placeholder="t('sidebar.projectPlaceholder')"
        />
      </div>

      <!-- Actions -->
      <div class="dialog-actions">
        <button class="btn-cancel" @click="emit('close')">{{ t('newProject.cancel') }}</button>
        <button
          class="btn-create"
          @click="handleCreate"
          :disabled="!projectName.trim()"
        >
          {{ t('newProject.create') }}
        </button>
      </div>
    </div>
  </NModal>
</template>

<style scoped>
.dialog {
  width: 520px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-deep);
  border: 1px solid var(--border-default);
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}

/* ─── Header ─── */

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 12px;
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

/* ─── Path Bar ─── */

.path-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 20px 10px;
}

.path-crumb {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
}
.path-crumb:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-dim);
}

.path-display {
  flex: 1;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-secondary);
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  padding: 5px 10px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.path-select {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: var(--radius-sm);
  background: var(--accent-dim);
  color: var(--accent);
  cursor: pointer;
  transition: all var(--transition-fast);
}
.path-select:hover {
  background: var(--accent);
  color: var(--bg-void);
}

/* ─── Directory List ─── */

.dir-list {
  flex: 1;
  min-height: 200px;
  max-height: 320px;
  overflow-y: auto;
  border-top: 1px solid var(--border-subtle);
  border-bottom: 1px solid var(--border-subtle);
  margin: 0 20px;
}

.dir-loading,
.dir-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 120px;
  font-size: 12px;
  color: var(--text-faint);
}

.dir-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  cursor: pointer;
  transition: all var(--transition-fast);
  color: var(--text-secondary);
}
.dir-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.dir-item.selected {
  background: var(--accent-dim);
  color: var(--accent);
}
.dir-item.selected .dir-enter {
  color: var(--accent);
}

.dir-name {
  flex: 1;
  font-size: 13px;
  font-family: var(--font-mono);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dir-enter {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: var(--radius-sm);
  color: var(--text-faint);
  opacity: 0;
  transition: all var(--transition-fast);
}
.dir-item:hover .dir-enter {
  opacity: 1;
}
.dir-enter:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

/* ─── Manual Path ─── */

.manual-row {
  display: flex;
  gap: 6px;
  padding: 10px 20px 0;
}

.manual-go {
  flex-shrink: 0;
  padding: 0 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 11px;
  cursor: pointer;
  transition: all var(--transition-fast);
}
.manual-go:hover {
  border-color: var(--accent);
  color: var(--accent);
}

/* ─── Name Row ─── */

.name-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 20px 0;
}

.name-label {
  flex-shrink: 0;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  color: var(--text-faint);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

/* ─── Actions ─── */

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 16px 20px;
}

.btn-cancel,
.btn-create {
  padding: 7px 18px;
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.btn-cancel {
  border: 1px solid var(--border-default);
  background: transparent;
  color: var(--text-muted);
}
.btn-cancel:hover {
  border-color: var(--text-muted);
  color: var(--text-primary);
}

.btn-create {
  border: none;
  background: var(--accent);
  color: var(--bg-void);
}
.btn-create:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.btn-create:not(:disabled):hover {
  filter: brightness(1.1);
}
</style>
