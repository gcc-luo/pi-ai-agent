<script setup lang="ts">
import { ref, computed, h, onUnmounted, watch, type VNode } from "vue";
import {
  NButton,
  NDataTable,
  NEmpty,
  NInput,
  NPagination,
  NSelect,
  NSpin,
  NSwitch,
  NTooltip,
  type DataTableColumns,
} from "naive-ui";
import { useKbFileStore } from "../stores/kb-file.js";
import { useI18n } from "../i18n/index.js";
import type { KbFileDto } from "@pi-web-ui/shared";
import ConfirmDialog from "./ConfirmDialog.vue";
import ImportFilesDialog from "./ImportFilesDialog.vue";
import KbFileDetailDialog from "./KbFileDetailDialog.vue";
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

async function handlePageChange(nextPage: number) {
  await kbFileStore.loadPage(props.kbId, nextPage);
}

async function handlePageSizeChange(nextPageSize: number) {
  if (nextPageSize === pageSize.value) return;
  kbFileStore.setPageSize(nextPageSize);
  await kbFileStore.loadPage(props.kbId, 1);
}

const tooltipOverrides = {
  fontSize: "12px",
  padding: "4px 8px",
  borderRadius: "4px",
  color: "var(--primary-color)",
  textColor: "#ffffff",
  boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)",
};

function renderAction(label: string, icon: VNode, onClick: () => void, danger = false) {
  return h(
    NTooltip,
    { delay: 200, placement: "top", themeOverrides: tooltipOverrides },
    {
      trigger: () => h(
        "button",
        {
          class: ["action-btn", { "action-danger": danger }],
          type: "button",
          "aria-label": label,
          onClick,
        },
        icon,
      ),
      default: () => label,
    },
  );
}

function icon(paths: VNode[]) {
  return h("svg", { width: "14", height: "14", viewBox: "0 0 14 14", fill: "none", "aria-hidden": "true" }, paths);
}

const detailIcon = () => icon([
  h("circle", { cx: "7", cy: "7", r: "5.5", stroke: "currentColor", "stroke-width": "1.2" }),
  h("path", { d: "M7 6.3v3.2M7 4v.6", stroke: "currentColor", "stroke-width": "1.2", "stroke-linecap": "round" }),
]);
const editIcon = () => icon([
  h("path", { d: "M10.5 1.5l2 2L4.5 11.5H2.5v-2L10.5 1.5z", stroke: "currentColor", "stroke-width": "1.2", "stroke-linecap": "round", "stroke-linejoin": "round" }),
]);
const reparseIcon = () => icon([
  h("path", { d: "M2 7a5 5 0 019.3-2.5M12 7a5 5 0 01-9.3 2.5", stroke: "currentColor", "stroke-width": "1.2", "stroke-linecap": "round" }),
  h("path", { d: "M11.3 1.5v3h-3M2.7 12.5v-3h3", stroke: "currentColor", "stroke-width": "1.2", "stroke-linecap": "round", "stroke-linejoin": "round" }),
]);
const deleteIcon = () => icon([
  h("path", { d: "M3 4h8l-.7 7.3a1 1 0 01-1 .7H4.7a1 1 0 01-1-.7L3 4zm2-2h4m-6 2V3a1 1 0 011-1h6a1 1 0 011 1v1", stroke: "currentColor", "stroke-width": "1.2", "stroke-linecap": "round", "stroke-linejoin": "round" }),
]);

const columns = computed<DataTableColumns<KbFileDto>>(() => [
  {
    title: t("kb.name"),
    key: "name",
    minWidth: 200,
    ellipsis: { tooltip: true },
    render: (file) => h(
      "button",
      { class: "file-name-btn", type: "button", onClick: () => openDetail(file.id) },
      file.name,
    ),
  },
  {
    title: t("kb.search.fileType"),
    key: "ext",
    width: 88,
    render: (file) => h("span", { class: "ext-badge" }, `.${file.ext}`),
  },
  {
    title: t("kb.size"),
    key: "size",
    width: 90,
    render: (file) => formatSize(file.size),
  },
  {
    title: t("kb.status"),
    key: "status",
    width: 180,
    render: (file) => h("span", { class: "file-status" }, [
      h("span", { class: "status-dot", style: { background: statusColor(file.status) } }),
      t(`kb.file.status.${file.status}`),
      file.status === "failed" && file.failReason
        ? h("span", { class: "fail-hint", title: file.failReason }, ` (${t(`kb.file.fail.${file.failReason}`) !== `kb.file.fail.${file.failReason}` ? t(`kb.file.fail.${file.failReason}`) : file.failReason})`)
        : null,
    ]),
  },
  {
    title: t("kb.chunkCount", { count: "" }),
    key: "chunkCount",
    width: 88,
    render: (file) => file.chunkCount ?? "—",
  },
  {
    title: t("kb.enabled"),
    key: "enabled",
    width: 84,
    render: (file) => h(NSwitch, {
      value: file.enabled,
      size: "small",
      "onUpdate:value": (enabled: boolean) => handleToggleEnabled(file, enabled),
    }),
  },
  {
    title: t("kb.actions"),
    key: "actions",
    width: 168,
    render: (file) => h("div", { class: "file-actions" }, [
      renderAction(t("kb.file.detail"), detailIcon(), () => openDetail(file.id)),
      ...(["txt", "md"].includes(file.ext)
        ? [renderAction(t("kb.file.edit"), editIcon(), () => openEditor(file.id))]
        : []),
      renderAction(t("kb.file.reparse"), reparseIcon(), () => handleReparse(file)),
      renderAction(t("kb.file.delete"), deleteIcon(), () => requestDelete(file), true),
    ]),
  },
]);

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
      <NDataTable
        v-else
        class="file-data-table"
        :columns="columns"
        :data="files"
        bordered
        :single-line="false"
        :scroll-x="950"
      />
    </div>

    <!-- Pagination -->
    <div v-if="files.length > 0" class="file-pagination">
      <span class="pagination-info">{{ t('kb.file.rangeInfo', { start: rangeStart, end: rangeEnd, total }) }}</span>
      <NPagination
        :page="page"
        :page-size="pageSize"
        :item-count="total"
        :page-sizes="[20, 50, 100]"
        show-size-picker
        show-quick-jumper
        @update:page="handlePageChange"
        @update:page-size="handlePageSizeChange"
      />
    </div>

    <!-- Drawers & Dialogs -->
    <KbFileDetailDialog
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

.file-data-table :deep(.n-data-table-th) {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.file-data-table :deep(.n-data-table-td) {
  font-size: 13px;
}

.file-data-table :deep(.file-name-btn) {
  border: none;
  background: transparent;
  color: var(--accent);
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  padding: 0;
  text-align: left;
  appearance: none;
  box-shadow: none;
  text-decoration: none;
  text-underline-offset: 3px;
  transition: color 60ms ease, text-decoration-color 60ms ease;
}
.file-data-table :deep(.file-name-btn:hover) {
  color: var(--primary-color);
  text-decoration: underline;
}

.file-data-table :deep(.ext-badge) {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
  border: 1px solid var(--border-default);
  color: var(--text-secondary);
}

.file-data-table :deep(.status-dot) {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  margin-right: 6px;
  vertical-align: middle;
}
.file-data-table :deep(.file-status),
.file-data-table :deep(.file-actions) {
  display: inline-flex;
  align-items: center;
}
.file-data-table :deep(.file-actions) {
  gap: 4px;
}

.file-data-table :deep(.fail-hint) {
  font-size: 11px;
  color: var(--rose);
  margin-left: 4px;
}

.file-data-table :deep(.action-btn) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  appearance: none;
  box-shadow: none;
  color: var(--text-muted);
  cursor: pointer;
  transition: background-color 60ms ease, color 60ms ease;
}
.file-data-table :deep(.action-btn:hover) {
  color: var(--text-primary);
}
.file-data-table :deep(.action-danger:hover) {
  color: var(--rose);
}

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
</style>
