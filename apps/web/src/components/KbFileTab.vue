<script setup lang="ts">
import { ref, computed, onUnmounted, watch } from "vue";
import { NButton, NSwitch, NInput, NSelect, NEmpty, NSpin, NTooltip } from "naive-ui";
import { useKbFileStore } from "../stores/kb-file.js";
import { useI18n } from "../i18n/index.js";
import type { KbFileDto } from "@pi-web-ui/shared";
import ConfirmDialog from "./ConfirmDialog.vue";
import ImportFilesDialog from "./ImportFilesDialog.vue";
import KbFileDetailDrawer from "./KbFileDetailDrawer.vue";
import KbFileEditorDrawer from "./KbFileEditorDrawer.vue";

const props = defineProps<{ kbId: string }>();

const kbFileStore = useKbFileStore();
const { t } = useI18n();

const showImport = ref(false);
const showCreateEditor = ref(false);
const detailFileId = ref<string | null>(null);
const editFileId = ref<string | null>(null);
const deleteTarget = ref<KbFileDto | null>(null);

// 搜索输入与 store.search 分离：输入框立即响应用户输入，但提交给服务端做 300ms 防抖
const searchInput = ref(kbFileStore.search);
let searchTimer: ReturnType<typeof setTimeout> | null = null;

watch(() => kbFileStore.search, (v) => {
  if (v !== searchInput.value) searchInput.value = v;
});

function onSearchInput(v: string) {
  searchInput.value = v;
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    kbFileStore.setSearch(props.kbId, v.trim());
  }, 300);
}

function onSearchClear() {
  if (searchTimer) clearTimeout(searchTimer);
  kbFileStore.setSearch(props.kbId, "");
}

const files = computed(() => kbFileStore.files(props.kbId));
const total = computed(() => kbFileStore.total(props.kbId));
const totalPages = computed(() => kbFileStore.totalPages(props.kbId));
const page = computed(() => kbFileStore.page);
const pageSize = computed(() => kbFileStore.pageSize);

const rangeStart = computed(() => total.value === 0 ? 0 : (page.value - 1) * pageSize.value + 1);
const rangeEnd = computed(() => Math.min(page.value * pageSize.value, total.value));

const statusOptions = computed(() => [
  { label: t("kb.file.status.pending"), value: "pending" },
  { label: t("kb.file.status.parsing"), value: "parsing" },
  { label: t("kb.file.status.ready"), value: "ready" },
  { label: t("kb.file.status.failed"), value: "failed" },
]);

const extOptions = computed(() => [
  { label: ".txt", value: "txt" },
  { label: ".md", value: "md" },
  { label: ".pdf", value: "pdf" },
  { label: ".docx", value: "docx" },
]);

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusColor(status: string): string {
  switch (status) {
    case "ready": return "var(--green)";
    case "parsing": return "var(--amber)";
    case "failed": return "var(--rose)";
    default: return "var(--text-muted)";
  }
}

async function handleToggleEnabled(file: KbFileDto, enabled: boolean) {
  try {
    await kbFileStore.toggleEnabled(file.id, enabled);
  } catch (e: any) {
    console.error("Failed to toggle file:", e);
  }
}

async function handleReparse(file: KbFileDto) {
  try {
    await kbFileStore.reparse(file.id, props.kbId);
  } catch (e: any) {
    console.error("Failed to reparse:", e);
  }
}

function requestDelete(file: KbFileDto) {
  deleteTarget.value = file;
}

async function confirmDelete() {
  if (!deleteTarget.value) return;
  try {
    await kbFileStore.remove(deleteTarget.value.id, props.kbId);
  } catch (e: any) {
    console.error("Failed to delete file:", e);
  } finally {
    deleteTarget.value = null;
  }
}

function openDetail(fileId: string) {
  detailFileId.value = fileId;
}

function openEditor(fileId: string) {
  editFileId.value = fileId;
}

function openCreateEditor() {
  editFileId.value = "__new__";
  showCreateEditor.value = true;
}

const tooltipOverrides = {
  fontSize: "12px",
  padding: "4px 8px",
  borderRadius: "4px",
  color: "var(--primary-color)",
  textColor: "#ffffff",
  boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)",
};

onUnmounted(() => {
  if (searchTimer) clearTimeout(searchTimer);
  kbFileStore.stopPolling(props.kbId);
});

async function handleImportDone() {
  showImport.value = false;
  await kbFileStore.loadForKb(props.kbId);
}
</script>

<template>
  <div class="kb-file-tab">
    <!-- Toolbar -->
    <div class="file-toolbar">
      <NInput
        v-model:value="searchInput"
        size="small"
        :placeholder="t('kb.search.placeholder')"
        clearable
        class="file-search"
        @input="onSearchInput"
        @clear="onSearchClear"
      />
      <NSelect
        :value="kbFileStore.status"
        :options="statusOptions"
        size="small"
        clearable
        :placeholder="t('kb.status')"
        class="file-filter"
        @update:value="(v: string | null) => kbFileStore.setStatus(kbId, v)"
      />
      <NSelect
        :value="kbFileStore.ext"
        :options="extOptions"
        size="small"
        clearable
        :placeholder="t('kb.search.fileType')"
        class="file-filter"
        @update:value="(v: string | null) => kbFileStore.setExt(kbId, v)"
      />
      <div class="file-toolbar-spacer" />
      <NButton size="small" @click="openCreateEditor">
        {{ t('kb.file.new') }}
      </NButton>
      <NButton size="small" type="primary" @click="showImport = true">
        {{ t('kb.file.import') }}
      </NButton>
    </div>

    <!-- File list -->
    <div class="file-body">
      <div v-if="kbFileStore.loading && !files.length" class="file-state">
        <NSpin size="small" />
      </div>
      <div v-else-if="!files.length" class="file-state">
        <NEmpty :description="t('kb.empty')" />
      </div>
      <table v-else class="file-table">
        <thead>
          <tr>
            <th class="col-name">{{ t('kb.name') }}</th>
            <th class="col-ext">{{ t('kb.search.fileType') }}</th>
            <th class="col-size">{{ t('kb.size') }}</th>
            <th class="col-status">{{ t('kb.status') }}</th>
            <th class="col-chunks">{{ t('kb.chunkCount', { count: '' }) }}</th>
            <th class="col-enabled">{{ t('kb.enabled') }}</th>
            <th class="col-actions">{{ t('kb.actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="file in files" :key="file.id">
            <td class="col-name">
              <button class="file-name-btn" @click="openDetail(file.id)">
                {{ file.name }}
              </button>
            </td>
            <td class="col-ext">
              <span class="ext-badge">.{{ file.ext }}</span>
            </td>
            <td class="col-size">{{ formatSize(file.size) }}</td>
            <td class="col-status">
              <span class="status-dot" :style="{ background: statusColor(file.status) }" />
              {{ t(`kb.file.status.${file.status}`) }}
              <span v-if="file.status === 'failed' && file.failReason" class="fail-hint" :title="file.failReason">
                ({{ t(`kb.file.fail.${file.failReason}`) !== `kb.file.fail.${file.failReason}` ? t(`kb.file.fail.${file.failReason}`) : file.failReason }})
              </span>
            </td>
            <td class="col-chunks">{{ file.chunkCount ?? '—' }}</td>
            <td class="col-enabled">
              <NSwitch
                :value="file.enabled"
                size="small"
                @update:value="(v: boolean) => handleToggleEnabled(file, v)"
              />
            </td>
            <td class="col-actions">
              <NTooltip v-if="['txt', 'md'].includes(file.ext)" :delay="200" placement="top" :theme-overrides="tooltipOverrides">
                <template #trigger>
                  <button class="action-btn" @click="openEditor(file.id)">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M10.5 1.5l2 2L4.5 11.5H2.5v-2L10.5 1.5z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                  </button>
                </template>
                {{ t('kb.file.edit') }}
              </NTooltip>
              <NTooltip :delay="200" placement="top" :theme-overrides="tooltipOverrides">
                <template #trigger>
                  <button class="action-btn" @click="handleReparse(file)">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M2 7a5 5 0 019.3-2.5M12 7a5 5 0 01-9.3 2.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
                      <path d="M11.3 1.5v3h-3M2.7 12.5v-3h3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                  </button>
                </template>
                {{ t('kb.file.reparse') }}
              </NTooltip>
              <NTooltip :delay="200" placement="top" :theme-overrides="tooltipOverrides">
                <template #trigger>
                  <button class="action-btn action-danger" @click="requestDelete(file)">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M3 4h8l-.7 7.3a1 1 0 01-1 .7H4.7a1 1 0 01-1-.7L3 4zm2-2h4m-6 2V3a1 1 0 011-1h6a1 1 0 011 1v1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                  </button>
                </template>
                {{ t('kb.file.delete') }}
              </NTooltip>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Pagination -->
    <div v-if="files.length > 0" class="file-pagination">
      <span class="pagination-info">{{ t('kb.file.rangeInfo', { start: rangeStart, end: rangeEnd, total }) }}</span>
      <div class="pagination-controls">
        <button
          class="page-btn"
          :disabled="page <= 1"
          :title="t('kb.file.prevPage')"
          @click="kbFileStore.loadPage(kbId, page - 1)"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M7.5 2L3.5 6l4 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
        <span class="pagination-page">{{ t('kb.file.pageInfo', { page, total: totalPages }) }}</span>
        <button
          class="page-btn"
          :disabled="page >= totalPages"
          :title="t('kb.file.nextPage')"
          @click="kbFileStore.loadPage(kbId, page + 1)"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M4.5 2l4 4-4 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
      </div>
    </div>

    <!-- Drawers & Dialogs -->
    <KbFileDetailDrawer
      :show="detailFileId !== null"
      :file-id="detailFileId"
      @close="detailFileId = null"
    />
    <KbFileEditorDrawer
      :show="editFileId !== null"
      :file-id="editFileId === '__new__' ? null : editFileId"
      :kb-id="kbId"
      :is-new="editFileId === '__new__'"
      @close="editFileId = null"
      @saved="editFileId = null; kbFileStore.loadForKb(kbId)"
    />
    <ImportFilesDialog
      :show="showImport"
      :kb-id="kbId"
      @close="showImport = false"
      @done="handleImportDone"
    />
    <ConfirmDialog
      :show="deleteTarget !== null"
      :title="t('file.deleteTitle')"
      :message="t('file.deleteMessage')"
      :confirm-label="t('file.deleteConfirm')"
      :cancel-label="t('file.deleteCancel')"
      :danger="true"
      @close="deleteTarget = null"
      @confirm="confirmDelete"
    />
  </div>
</template>

<style scoped>
.kb-file-tab {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  height: 100%;
}

.file-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 28px 12px;
  flex-shrink: 0;
  flex-wrap: wrap;
}
.file-search {
  width: 220px;
}
.file-filter {
  width: 130px;
}
.file-toolbar-spacer {
  flex: 1;
}

.file-body {
  flex: 1;
  overflow-y: auto;
  padding: 0 28px 12px;
}
.file-state {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 60px 0;
}

.file-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  table-layout: auto;
}
.file-table th {
  text-align: left;
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
  padding: 8px 10px;
  border-bottom: 1px solid var(--border-default);
  white-space: nowrap;
}
.file-table td {
  padding: 10px 10px;
  border-bottom: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  vertical-align: middle;
}
.file-table tr:hover td {
  background: var(--bg-hover);
}
.col-name {
  width: auto;
  min-width: 200px;
}
.col-ext { width: 1%; white-space: nowrap; }
.col-size { width: 1%; white-space: nowrap; }
.col-status { width: 1%; white-space: nowrap; }
.col-chunks { width: 1%; white-space: nowrap; }
.col-enabled { width: 1%; white-space: nowrap; }
.col-actions {
  width: 1%;
  white-space: nowrap;
  min-width: 132px;
}

.file-name-btn {
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  padding: 0;
  text-align: left;
  transition: color 60ms ease;
}
.file-name-btn:hover {
  color: var(--accent);
}

.ext-badge {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
  border: 1px solid var(--border-default);
  color: var(--text-secondary);
}

.status-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  margin-right: 6px;
  vertical-align: middle;
}

.fail-hint {
  font-size: 11px;
  color: var(--rose);
  margin-left: 4px;
}

.action-btn {
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
  transition: background-color 60ms ease, color 60ms ease;
}
.action-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.action-danger:hover {
  color: var(--rose);
}

/* ─── Pagination ─── */
.file-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 28px 16px;
  border-top: 1px solid var(--border-subtle);
  flex-shrink: 0;
  gap: 12px;
}
.pagination-info {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
}
.pagination-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}
.page-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 60ms ease;
}
.page-btn:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}
.page-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.pagination-page {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-secondary);
  min-width: 64px;
  text-align: center;
}
</style>
