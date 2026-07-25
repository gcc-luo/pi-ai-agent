<script setup lang="ts">
import { onMounted, ref, computed, h, type VNode } from "vue";
import {
  NButton,
  NDataTable,
  NEmpty,
  NModal,
  NPagination,
  NSpin,
  NSwitch,
  NTag,
  NTooltip,
  useMessage,
  type DataTableColumns,
} from "naive-ui";
import { useScheduledTasksStore } from "../stores/scheduled-tasks.js";
import { useProjectStore } from "../stores/project.js";
import { useI18n } from "../i18n/index.js";
import { cronToHuman, timeAgo, formatDateTime } from "../utils/cron-helper.js";
import type { ScheduledTaskDto, TaskLogDto } from "@pi-web-ui/shared";
import CreateScheduledTaskDialog from "./CreateScheduledTaskDialog.vue";
import ConfirmDialog from "./ConfirmDialog.vue";

const emit = defineEmits<{
  "navigate-session": [payload: { projectId: string; sessionId: string }];
}>();

const store = useScheduledTasksStore();
const projectStore = useProjectStore();
const { t } = useI18n();
const message = useMessage();

// ─── State ───
const showCreate = ref(false);
const editTask = ref<ScheduledTaskDto | null>(null);
const deleteTarget = ref<ScheduledTaskDto | null>(null);

// Logs modal
const logsTaskId = ref<string | null>(null);
const logsLoading = ref(false);

// Client-side pagination
const page = ref(1);
const pageSize = ref(20);

const total = computed(() => store.tasks.length);
const pagedTasks = computed(() => {
  const start = (page.value - 1) * pageSize.value;
  return store.tasks.slice(start, start + pageSize.value);
});
const rangeStart = computed(() => total.value === 0 ? 0 : (page.value - 1) * pageSize.value + 1);
const rangeEnd = computed(() => Math.min(page.value * pageSize.value, total.value));

function handlePageChange(next: number) {
  page.value = next;
}
function handlePageSizeChange(next: number) {
  pageSize.value = next;
  page.value = 1;
}

onMounted(() => {
  store.loadAll();
});

// ─── Helpers ───

function projectName(id: string | null): string {
  if (!id) return "—";
  return projectStore.projects.find((p) => p.id === id)?.name ?? "—";
}

function navigateToSession(task: ScheduledTaskDto, log: TaskLogDto) {
  if (log.sessionId && task.projectId) {
    emit("navigate-session", { projectId: task.projectId, sessionId: log.sessionId });
  }
}

// ─── Actions ───

async function handleToggle(task: ScheduledTaskDto, enabled: boolean) {
  try {
    await store.toggle(task.id, enabled);
  } catch (e: any) {
    message.error(e?.message ?? "Toggle failed");
  }
}

async function handleRun(task: ScheduledTaskDto) {
  try {
    await store.runNow(task.id);
    message.success(t("scheduledTasks.runTriggered"));
    // Refresh logs after a short delay if logs modal is open for this task
    setTimeout(async () => {
      if (logsTaskId.value === task.id) {
        await store.loadLogs(task.id);
      }
    }, 2000);
  } catch (e: any) {
    message.error(e?.message ?? "Run failed");
  }
}

async function openLogs(task: ScheduledTaskDto) {
  logsTaskId.value = task.id;
  logsLoading.value = true;
  try {
    await store.loadLogs(task.id);
  } catch (e: any) {
    message.error(e?.message ?? "Load logs failed");
  } finally {
    logsLoading.value = false;
  }
}

function closeLogs() {
  logsTaskId.value = null;
}

function handleEdit(task: ScheduledTaskDto) {
  editTask.value = task;
  showCreate.value = true;
}

async function handleSubmit(data: {
  name: string; description: string; cronExpression: string;
  taskType: string; payload: string; projectId?: string;
  createNewSession?: boolean; enabled: boolean;
}) {
  try {
    if (editTask.value) {
      await store.update(editTask.value.id, data as any);
    } else {
      await store.create(data as any);
    }
    showCreate.value = false;
    editTask.value = null;
  } catch (e: any) {
    message.error(e?.message ?? "Save failed");
  }
}

async function confirmDelete() {
  if (!deleteTarget.value) return;
  try {
    await store.remove(deleteTarget.value.id);
    message.success(t("file.deleted"));
    // Clamp page if current page is now empty
    if (pagedTasks.value.length === 0 && page.value > 1) {
      page.value--;
    }
  } catch (e: any) {
    message.error(e?.message ?? "Delete failed");
  } finally {
    deleteTarget.value = null;
  }
}

// ─── Log display helpers ───

function logStatusLabel(status: string): string {
  switch (status) {
    case "success": return t("scheduledTasks.logSuccess");
    case "failed": return t("scheduledTasks.logFailed");
    case "running": return t("scheduledTasks.logRunning");
    default: return status;
  }
}

function logStatusType(status: string): "success" | "error" | "info" {
  switch (status) {
    case "success": return "success";
    case "failed": return "error";
    default: return "info";
  }
}

// ─── Table columns ───

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

const runIcon = () => icon([
  h("path", { d: "M3 2l9 5-9 5V2z", stroke: "currentColor", "stroke-width": "1.2", "stroke-linecap": "round", "stroke-linejoin": "round" }),
]);
const logsIcon = () => icon([
  h("path", { d: "M2 3h10v8H2V3zm2 2.5h6M4 7h4", stroke: "currentColor", "stroke-width": "1.2", "stroke-linecap": "round", "stroke-linejoin": "round" }),
]);
const editIcon = () => icon([
  h("path", { d: "M10.5 1.5l2 2L4.5 11.5H2.5v-2L10.5 1.5z", stroke: "currentColor", "stroke-width": "1.2", "stroke-linecap": "round", "stroke-linejoin": "round" }),
]);
const deleteIcon = () => icon([
  h("path", { d: "M3 4h8l-.7 7.3a1 1 0 01-1 .7H4.7a1 1 0 01-1-.7L3 4zm2-2h4m-6 2V3a1 1 0 011-1h6a1 1 0 011 1v1", stroke: "currentColor", "stroke-width": "1.2", "stroke-linecap": "round", "stroke-linejoin": "round" }),
]);

const columns = computed<DataTableColumns<ScheduledTaskDto>>(() => [
  {
    title: t("scheduledTasks.name"),
    key: "name",
    minWidth: 160,
    ellipsis: { tooltip: true },
    render: (task) => {
      const children: VNode[] = [h("span", { class: "task-name-text" }, task.name)];
      if (task.description) {
        children.push(h("span", { class: "task-desc" }, task.description));
      }
      return h("div", { class: "task-name-cell" }, children);
    },
  },
  {
    title: t("scheduledTasks.taskType"),
    key: "taskType",
    width: 100,
    render: (task) => h(
      NTag,
      { size: "small", bordered: false, type: task.taskType === "prompt" ? "info" : "warning" },
      { default: () => t(`scheduledTasks.type.${task.taskType}`) },
    ),
  },
  {
    title: t("scheduledTasks.targetProject"),
    key: "projectId",
    width: 140,
    ellipsis: { tooltip: true },
    render: (task) => h("span", { class: "project-cell" }, projectName(task.projectId)),
  },
  {
    title: t("scheduledTasks.cronExpression"),
    key: "cronExpression",
    width: 160,
    render: (task) => h("span", { class: "cron-cell" }, cronToHuman(task.cronExpression)),
  },
  {
    title: t("scheduledTasks.lastRun"),
    key: "lastRunAt",
    width: 120,
    render: (task) => h("span", { class: "time-cell" }, timeAgo(task.lastRunAt)),
  },
  {
    title: t("scheduledTasks.nextRun"),
    key: "nextRunAt",
    width: 150,
    render: (task) => h("span", { class: "time-cell" }, formatDateTime(task.nextRunAt)),
  },
  {
    title: t("scheduledTasks.enabled"),
    key: "enabled",
    width: 80,
    render: (task) => h(NSwitch, {
      value: task.enabled,
      size: "small",
      "onUpdate:value": (v: boolean) => handleToggle(task, v),
    }),
  },
  {
    title: t("scheduledTasks.actions"),
    key: "actions",
    width: 160,
    render: (task) => h("div", { class: "task-actions" }, [
      renderAction(t("scheduledTasks.runNow"), runIcon(), () => handleRun(task)),
      renderAction(t("scheduledTasks.viewLogs"), logsIcon(), () => openLogs(task)),
      renderAction(t("scheduledTasks.edit"), editIcon(), () => handleEdit(task)),
      renderAction(t("scheduledTasks.delete"), deleteIcon(), () => { deleteTarget.value = task; }, true),
    ]),
  },
]);

// Logs for the currently-viewed task
const logsTask = computed(() => store.tasks.find((t) => t.id === logsTaskId.value) ?? null);
const currentLogs = computed(() => logsTaskId.value ? (store.logs[logsTaskId.value] ?? []) : []);
</script>

<template>
  <div class="tasks-view">
    <!-- Header -->
    <header class="tasks-header">
      <div class="tasks-header-text">
        <h1 class="tasks-title">{{ t('scheduledTasks.title') }}</h1>
        <p class="tasks-subtitle">{{ t('scheduledTasks.subtitle') }}</p>
      </div>
      <NButton class="tasks-create-button" size="small" type="primary" @click="showCreate = true; editTask = null">
        {{ t('scheduledTasks.create') }}
      </NButton>
    </header>

    <!-- Table body -->
    <div class="tasks-body">
      <div v-if="store.loading && !store.tasks.length" class="tasks-state">
        <NSpin size="medium" />
      </div>
      <div v-else-if="!store.tasks.length" class="tasks-state">
        <NEmpty :description="t('scheduledTasks.empty')">
          <template #extra>
            <span class="empty-hint">{{ t('scheduledTasks.emptyHint') }}</span>
          </template>
        </NEmpty>
      </div>
      <NDataTable
        v-else
        class="task-data-table"
        :columns="columns"
        :data="pagedTasks"
        size="small"
        bordered
        :single-line="false"
        :scroll-x="1100"
      />
    </div>

    <!-- Pagination -->
    <div v-if="store.tasks.length > 0" class="tasks-pagination">
      <span class="pagination-info">
        {{ t('scheduledTasks.rangeInfo', { start: rangeStart, end: rangeEnd, total }) }}
      </span>
      <NPagination
        :page="page"
        :page-size="pageSize"
        :item-count="total"
        :page-sizes="[10, 20, 50, 100]"
        show-size-picker
        show-quick-jumper
        @update:page="handlePageChange"
        @update:page-size="handlePageSizeChange"
      />
    </div>

    <!-- Create / Edit Dialog -->
    <CreateScheduledTaskDialog
      :show="showCreate"
      :task="editTask"
      @close="showCreate = false; editTask = null"
      @submit="handleSubmit"
    />

    <!-- Delete Confirm -->
    <ConfirmDialog
      :show="deleteTarget !== null"
      :title="t('scheduledTasks.deleteConfirmTitle')"
      :message="t('scheduledTasks.deleteConfirmMessage')"
      :confirm-label="t('scheduledTasks.delete')"
      :cancel-label="t('delete.cancel')"
      :danger="true"
      @close="deleteTarget = null"
      @confirm="confirmDelete"
    />

    <!-- Execution Logs Modal -->
    <NModal
      :show="logsTaskId !== null"
      preset="card"
      :title="logsTask ? `${t('scheduledTasks.logs')} — ${logsTask.name}` : t('scheduledTasks.logs')"
      :style="{ width: '640px', maxWidth: '95vw' }"
      :mask-closable="true"
      @update:show="(v: boolean) => !v && closeLogs()"
    >
      <div v-if="logsLoading" class="logs-modal-loading">
        <NSpin size="small" />
      </div>
      <div v-else-if="!currentLogs.length" class="logs-modal-empty">
        <NEmpty :description="t('scheduledTasks.noLogs')" size="small" />
      </div>
      <div v-else class="logs-modal-list">
        <div v-for="log in currentLogs" :key="log.id" class="log-modal-item">
          <div class="log-modal-header">
            <NTag size="tiny" :bordered="false" :type="logStatusType(log.status)">
              {{ logStatusLabel(log.status) }}
            </NTag>
            <span class="log-modal-time">{{ formatDateTime(log.startedAt) }}</span>
            <button
              v-if="log.sessionId && logsTask?.projectId"
              class="log-session-link"
              @click="navigateToSession(logsTask!, log)"
            >
              {{ t('scheduledTasks.viewSession') }}
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <path d="M6 3l5 5-5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>
          <pre v-if="log.output" class="log-modal-output">{{ log.output }}</pre>
        </div>
      </div>
    </NModal>
  </div>
</template>

<style scoped>
.tasks-view {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-width: 0;
  overflow: hidden;
  height: 100%;
}

/* ─── Header ─── */
.tasks-header {
  display: flex;
  align-items: center;
  width: 100%;
  box-sizing: border-box;
  padding: 20px 28px 0;
  flex-shrink: 0;
}
.tasks-header-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.tasks-title {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
}
.tasks-subtitle {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
}
.tasks-create-button {
  margin-left: auto;
  flex-shrink: 0;
}

/* ─── Body ─── */
.tasks-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 28px 12px;
}
.tasks-state {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 60px 0;
}
.empty-hint {
  font-size: 12px;
  color: var(--text-muted);
}

/* ─── Table overrides ─── */
.task-data-table :deep(.n-data-table-th) {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 8px 12px;
}
.task-data-table :deep(.n-data-table-td) {
  font-size: 13px;
  padding: 8px 12px;
}

/* Name cell with description subtitle */
.task-data-table :deep(.task-name-cell) {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.task-data-table :deep(.task-name-text) {
  font-weight: 600;
  color: var(--text-primary);
}
.task-data-table :deep(.task-desc) {
  font-size: 11px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 260px;
}

/* Project cell */
.task-data-table :deep(.project-cell) {
  color: var(--text-secondary);
}

/* Cron cell */
.task-data-table :deep(.cron-cell) {
  font-weight: 500;
  color: var(--primary-color);
}

/* Time cell */
.task-data-table :deep(.time-cell) {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
}

/* Action buttons */
.task-data-table :deep(.task-actions) {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.task-data-table :deep(.action-btn) {
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
.task-data-table :deep(.action-btn:hover) {
  color: var(--text-primary);
}
.task-data-table :deep(.action-danger:hover) {
  color: var(--rose);
}

/* ─── Pagination ─── */
.tasks-pagination {
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

/* ─── Logs modal ─── */
.logs-modal-loading,
.logs-modal-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px 0;
}

.logs-modal-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 480px;
  overflow-y: auto;
}

.log-modal-item {
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 10px 14px;
  background: var(--background-page);
}

.log-modal-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.log-modal-time {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
}

.log-session-link {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-left: auto;
  padding: 0;
  border: none;
  background: none;
  font-size: 11px;
  font-weight: 500;
  color: var(--primary-color);
  cursor: pointer;
  transition: opacity 0.15s;
}
.log-session-link:hover {
  opacity: 0.75;
  text-decoration: underline;
}

.log-modal-output {
  margin: 0;
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary);
  background: var(--bg-surface);
  border-radius: var(--radius-sm);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 200px;
  overflow-y: auto;
}
</style>
