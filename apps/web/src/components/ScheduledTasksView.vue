<script setup lang="ts">
import { onMounted, ref, computed, h, watch, type VNode } from "vue";
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
import { api } from "../api/client.js";
import { messagesForExecution } from "../utils/scheduled-task-logs.js";
import type { MessageDto, ScheduledTaskCapabilities, ScheduledTaskDto, TaskLogDto } from "@pi-web-ui/shared";
import CreateScheduledTaskDialog from "./CreateScheduledTaskDialog.vue";
import ConfirmDialog from "./ConfirmDialog.vue";

const emit = defineEmits<{
  "navigate-session": [payload: { projectId: string; sessionId: string; messageId?: string | null }];
  "manage-connectors": [];
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
const logsPage = ref(1);
const logsPageSize = ref(10);
const detailLog = ref<TaskLogDto | null>(null);
const detailMessages = ref<MessageDto[]>([]);
const detailLoading = ref(false);
const detailError = ref<string | null>(null);

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
    emit("navigate-session", {
      projectId: task.projectId,
      sessionId: log.sessionId,
      messageId: log.messageId,
    });
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
  logsPage.value = 1;
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
  closeLogDetail();
}

function handleEdit(task: ScheduledTaskDto) {
  editTask.value = task;
  showCreate.value = true;
}

async function handleSubmit(data: {
  name: string; description: string; cronExpression: string;
  taskType: string; payload: string; projectId?: string;
  createNewSession?: boolean; capabilities: ScheduledTaskCapabilities; enabled: boolean;
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

function logOutputSummary(log: TaskLogDto): string {
  const output = log.output.trim();
  if (!output) return "—";
  return output.split("\n").find((line) => line.trim())?.trim() ?? "—";
}

async function openLogDetail(log: TaskLogDto) {
  detailLog.value = log;
  detailMessages.value = [];
  detailError.value = null;
  detailLoading.value = true;
  if (!log.sessionId) {
    detailLoading.value = false;
    return;
  }
  try {
    const messages = await api.listMessages(log.sessionId);
    detailMessages.value = messagesForExecution(log, messages);
  } catch (error) {
    detailError.value = error instanceof Error ? error.message : "加载执行对话失败";
  } finally {
    detailLoading.value = false;
  }
}

function closeLogDetail() {
  detailLog.value = null;
  detailMessages.value = [];
  detailError.value = null;
}

function navigateFromDetail() {
  if (detailLog.value && logsTask.value) {
    navigateToSession(logsTask.value, detailLog.value);
  }
  closeLogDetail();
  closeLogs();
}

function messageRoleLabel(role: MessageDto["role"]): string {
  if (role === "user") return "用户提示词";
  if (role === "assistant") return "AI 回复";
  return "工具消息";
}

// ─── Table columns ───

const tooltipOverrides = {
  fontSize: "12px",
  padding: "4px 8px",
  borderRadius: "4px",
  color: "var(--bg-surface)",
  textColor: "var(--text-primary)",
  boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)",
};

const paginationThemeOverrides = {
  itemTextColor: "var(--text-secondary)",
  itemTextColorHover: "var(--primary-color)",
  itemTextColorPressed: "var(--primary-color)",
  itemTextColorActive: "var(--primary-color)",
  itemTextColorDisabled: "var(--text-disabled)",
  itemColor: "transparent",
  itemColorHover: "var(--background-hover)",
  itemColorActive: "var(--background-selected)",
  itemColorActiveHover: "var(--background-selected)",
  itemColorDisabled: "var(--background-page)",
  itemBorder: "1px solid transparent",
  itemBorderHover: "1px solid var(--border-color)",
  itemBorderActive: "1px solid var(--primary-color)",
  itemBorderRadius: "4px",
  jumperTextColor: "var(--text-secondary)",
  buttonColor: "var(--background-panel)",
  buttonColorHover: "var(--background-hover)",
  buttonBorder: "1px solid var(--border-color)",
  buttonBorderHover: "1px solid var(--border-active)",
  buttonIconColor: "var(--text-muted)",
  buttonIconColorHover: "var(--text-primary)",
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
    width: 176,
    fixed: "right",
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
const logsTotal = computed(() => currentLogs.value.length);
const pagedLogs = computed(() => {
  const start = (logsPage.value - 1) * logsPageSize.value;
  return currentLogs.value.slice(start, start + logsPageSize.value);
});
const logsRangeStart = computed(() => logsTotal.value === 0 ? 0 : (logsPage.value - 1) * logsPageSize.value + 1);
const logsRangeEnd = computed(() => Math.min(logsPage.value * logsPageSize.value, logsTotal.value));

watch(currentLogs, () => {
  const lastPage = Math.max(1, Math.ceil(logsTotal.value / logsPageSize.value));
  if (logsPage.value > lastPage) logsPage.value = lastPage;
});

function handleLogsPageSizeChange(next: number) {
  logsPageSize.value = next;
  logsPage.value = 1;
}

const logColumns = computed<DataTableColumns<TaskLogDto>>(() => [
  {
    title: "状态",
    key: "status",
    width: 92,
    render: (log) => h(NTag, { size: "small", bordered: false, type: logStatusType(log.status) }, {
      default: () => logStatusLabel(log.status),
    }),
  },
  {
    title: "执行时间",
    key: "startedAt",
    width: 150,
    render: (log) => h("span", { class: "log-table-time" }, formatDateTime(log.startedAt)),
  },
  {
    title: "执行结果",
    key: "output",
    ellipsis: { tooltip: true },
    render: (log) => h("span", { class: "log-output-summary" }, logOutputSummary(log)),
  },
  {
    title: "操作",
    key: "actions",
    width: 180,
    render: (log) => h("div", { class: "log-table-actions" }, [
      h(NButton, {
        size: "small",
        secondary: true,
        onClick: () => openLogDetail(log),
      }, { default: () => "详情" }),
      h(NButton, {
        size: "small",
        quaternary: true,
        disabled: !(log.sessionId && logsTask.value?.projectId),
        onClick: () => logsTask.value && navigateToSession(logsTask.value, log),
      }, { default: () => t("scheduledTasks.viewSession") }),
    ]),
  },
]);
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
        :scroll-x="1120"
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
        :theme-overrides="paginationThemeOverrides"
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
      @manage-connectors="emit('manage-connectors')"
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
      <template v-else>
        <NDataTable
          class="logs-modal-table"
          :columns="logColumns"
          :data="pagedLogs"
          :pagination="false"
          :single-line="false"
          :scroll-x="560"
          size="small"
          bordered
        />
        <div class="logs-modal-pagination">
          <span class="logs-pagination-info">显示第 {{ logsRangeStart }}–{{ logsRangeEnd }} 条，共 {{ logsTotal }} 条</span>
          <NPagination
            :page="logsPage"
            :page-size="logsPageSize"
            :item-count="logsTotal"
            :page-sizes="[10, 20, 50]"
            :theme-overrides="paginationThemeOverrides"
            show-size-picker
            @update:page="(next: number) => logsPage = next"
            @update:page-size="handleLogsPageSizeChange"
          />
        </div>
      </template>
    </NModal>

    <!-- Execution conversation detail -->
    <NModal
      class="log-detail-modal"
      :show="detailLog !== null"
      preset="card"
      title="本次执行对话"
      :style="{ width: '680px', maxWidth: '95vw' }"
      :mask-closable="true"
      @update:show="(v: boolean) => !v && closeLogDetail()"
    >
      <div class="log-detail-meta" v-if="detailLog">
        <NTag size="small" :bordered="false" :type="logStatusType(detailLog.status)">
          {{ logStatusLabel(detailLog.status) }}
        </NTag>
        <span>{{ formatDateTime(detailLog.startedAt) }}</span>
        <span v-if="logsTask">{{ logsTask.name }}</span>
      </div>
      <div v-if="detailLoading" class="logs-modal-loading">
        <NSpin size="small" />
      </div>
      <div v-else-if="detailError" class="log-detail-error" role="alert">{{ detailError }}</div>
      <div v-else-if="detailMessages.length" class="log-detail-messages">
        <article
          v-for="item in detailMessages"
          :key="item.id"
          class="log-detail-message"
          :class="item.role"
        >
          <div class="log-detail-message-role">{{ messageRoleLabel(item.role) }}</div>
          <pre class="log-detail-message-content">{{ item.content || '—' }}</pre>
        </article>
      </div>
      <div v-else class="log-detail-fallback">
        <NEmpty description="该执行没有可定位的会话消息" size="small" />
        <pre v-if="detailLog?.output" class="log-modal-output">{{ detailLog.output }}</pre>
      </div>
      <div class="log-detail-footer">
        <NButton @click="closeLogDetail">关闭</NButton>
        <NButton
          v-if="detailLog?.sessionId && logsTask?.projectId"
          type="primary"
          @click="navigateFromDetail"
        >
          {{ t('scheduledTasks.viewSession') }}
        </NButton>
      </div>
    </NModal>
  </div>
</template>

<style scoped>
.tasks-view {
  --task-surface: var(--background-panel);
  --task-page: var(--background-page);
  --task-header: var(--bg-elevated);
  --task-hover: var(--background-hover);
  --task-border: var(--border-color);
  --task-text: var(--text-primary);
  --task-secondary: var(--text-secondary);
  --task-muted: var(--text-muted);
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
  padding: 32px 48px 24px;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}
.tasks-header-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.tasks-title {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  color: var(--text-primary);
}
.tasks-subtitle {
  margin: 0;
  font-size: 13px;
  color: var(--text-secondary);
}
.tasks-create-button {
  margin-left: auto;
  flex-shrink: 0;
}

/* ─── Body ─── */
.tasks-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px 48px 16px;
  background: var(--task-page);
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
  background: var(--task-header);
  color: var(--task-secondary);
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0;
  padding: 12px 14px;
  white-space: nowrap;
}
.task-data-table :deep(.n-data-table-td) {
  font-size: 13px;
  padding: 12px 14px;
  color: var(--task-text);
  background: var(--task-surface);
  transition: background-color 0.15s ease;
}
.task-data-table :deep(.n-data-table-tr:hover .n-data-table-td) {
  background: var(--task-hover);
}
.task-data-table :deep(.n-data-table-th),
.task-data-table :deep(.n-data-table-td) {
  border-color: var(--task-border);
}
.task-data-table :deep(.n-data-table-wrapper) {
  border: 1px solid var(--task-border);
  border-radius: 6px;
  background: var(--task-surface);
}
.task-data-table :deep(.n-data-table-base-table-header) {
  background: var(--task-header);
}
.task-data-table :deep(.n-data-table-td--last-col) {
  border-right: 0;
}
/* Keep the pinned action column opaque while content scrolls beneath it. */
.task-data-table :deep(.n-data-table-td--fixed-right),
.task-data-table :deep(.n-data-table-th--fixed-right) {
  background: var(--task-surface);
}
.task-data-table :deep(.n-data-table-th--fixed-right) {
  background: var(--task-header);
}
.task-data-table :deep(.n-data-table-td--fixed-right)::after,
.task-data-table :deep(.n-data-table-th--fixed-right)::after {
  box-shadow: -6px 0 8px -7px rgba(31, 45, 61, 0.28);
}

/* Name cell with description subtitle */
.task-data-table :deep(.task-name-cell) {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.task-data-table :deep(.task-name-text) {
  font-weight: 600;
  color: var(--task-text);
}
.task-data-table :deep(.task-desc) {
  font-size: 12px;
  color: var(--task-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 260px;
}

/* Project cell */
.task-data-table :deep(.project-cell) {
  color: var(--task-secondary);
}

/* Cron cell */
.task-data-table :deep(.cron-cell) {
  font-weight: 500;
  color: var(--primary-color);
}

/* Time cell */
.task-data-table :deep(.time-cell) {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--task-muted);
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
  color: var(--task-muted);
  cursor: pointer;
  transition: background-color 60ms ease, color 60ms ease;
}
.task-data-table :deep(.action-btn:hover) {
  color: var(--primary-color);
  background: var(--primary-light);
}
.task-data-table :deep(.action-danger:hover) {
  color: var(--danger-color);
  background: var(--rose-dim);
}

/* ─── Pagination ─── */
.tasks-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 48px 18px;
  border-top: 1px solid var(--task-border);
  background: var(--task-page);
  flex-shrink: 0;
  gap: 12px;
}
.pagination-info {
  flex-shrink: 0;
  white-space: nowrap;
  font-size: 12px;
  color: var(--task-secondary);
}

.tasks-pagination :deep(.n-base-selection-label) {
  background: var(--background-panel);
  color: var(--text-secondary);
  box-shadow: inset 0 0 0 1px var(--border-color);
}
.tasks-pagination :deep(.n-input) {
  background: var(--background-panel);
  color: var(--text-secondary);
}
.tasks-pagination :deep(.n-input__border),
.tasks-pagination :deep(.n-input__state-border) {
  border-color: var(--border-color);
}

@media (max-width: 900px) {
  .tasks-header {
    padding: 24px;
  }
  .tasks-body {
    padding: 16px 24px 12px;
  }
  .tasks-pagination {
    padding: 12px 24px 16px;
  }
}

@media (max-width: 620px) {
  .tasks-header {
    padding: 20px 16px;
  }
  .tasks-body {
    padding: 12px 16px;
  }
  .tasks-pagination {
    align-items: flex-start;
    flex-direction: column;
    padding: 12px 16px 16px;
  }
}

/* ─── Logs modal ─── */
.logs-modal-loading,
.logs-modal-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px 0;
}

.logs-modal-table {
  --log-table-surface: var(--background-panel);
  --log-table-header: var(--bg-elevated);
  --log-table-hover: var(--background-hover);
  --log-table-border: var(--border-color);
}
.logs-modal-table :deep(.n-data-table-th) {
  background: var(--log-table-header);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
  padding: 10px 12px;
}
.logs-modal-table :deep(.n-data-table-td) {
  background: var(--log-table-surface);
  border-color: var(--log-table-border);
  color: var(--text-primary);
  font-size: 12px;
  padding: 10px 12px;
}
.logs-modal-table :deep(.n-data-table-tr:hover .n-data-table-td) {
  background: var(--log-table-hover);
}
.logs-modal-table :deep(.n-data-table-wrapper) {
  border: 1px solid var(--log-table-border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}
.log-table-time {
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 11px;
  white-space: nowrap;
}
.log-output-summary {
  color: var(--text-secondary);
  display: block;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.log-table-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}
.logs-modal-pagination {
  align-items: center;
  border-top: 1px solid var(--border-color);
  display: flex;
  gap: 12px;
  justify-content: space-between;
  padding: 12px 0 0;
}
.logs-pagination-info {
  color: var(--text-secondary);
  flex-shrink: 0;
  font-size: 12px;
}

.log-detail-meta {
  align-items: center;
  color: var(--text-muted);
  display: flex;
  flex-wrap: wrap;
  font-size: 12px;
  gap: 8px;
  margin-bottom: 14px;
}
.log-detail-messages {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 420px;
  overflow-y: auto;
}
.log-detail-message {
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 10px 12px;
}
.log-detail-message.user {
  background: var(--primary-light);
  border-color: color-mix(in srgb, var(--primary-color) 35%, var(--border-color));
  margin-left: 42px;
}
.log-detail-message.assistant {
  background: var(--background-page);
  margin-right: 42px;
}
.log-detail-message.tool {
  background: var(--background-hover);
  margin-right: 42px;
}
.log-detail-message-role {
  color: var(--text-muted);
  font-size: 11px;
  margin-bottom: 6px;
}
.log-detail-message-content {
  margin: 0;
  padding: 0;
  color: var(--text-primary);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}
.log-detail-error {
  color: var(--danger-color);
  padding: 20px 0;
}
.log-detail-fallback {
  color: var(--text-secondary);
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.log-detail-footer {
  border-top: 1px solid var(--border-color);
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 18px;
  padding-top: 14px;
}

@media (max-width: 620px) {
  .logs-modal-pagination {
    align-items: flex-start;
    flex-direction: column;
  }
  .log-detail-message.user,
  .log-detail-message.assistant,
  .log-detail-message.tool {
    margin-left: 0;
    margin-right: 0;
  }
}
</style>
