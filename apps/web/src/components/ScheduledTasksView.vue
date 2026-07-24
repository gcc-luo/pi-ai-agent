<script setup lang="ts">
import { onMounted, ref } from "vue";
import { NButton, NSpin, NEmpty, NSwitch, NTag, useMessage } from "naive-ui";
import { useScheduledTasksStore } from "../stores/scheduled-tasks.js";
import { useI18n } from "../i18n/index.js";
import { cronToHuman, timeAgo, formatDateTime } from "../utils/cron-helper.js";
import type { ScheduledTaskDto, TaskLogDto } from "@pi-web-ui/shared";
import CreateScheduledTaskDialog from "./CreateScheduledTaskDialog.vue";
import ConfirmDialog from "./ConfirmDialog.vue";

const store = useScheduledTasksStore();
const { t } = useI18n();
const message = useMessage();

const showCreate = ref(false);
const editTask = ref<ScheduledTaskDto | null>(null);
const deleteTarget = ref<string | null>(null);
const expandedLogs = ref<Set<string>>(new Set());
const logsLoading = ref<Set<string>>(new Set());

onMounted(() => {
  store.loadAll();
});

function typeLabel(type: string): string {
  return t(`scheduledTasks.type.${type}`);
}

function typeTagType(type: string): "info" | "warning" {
  return type === "prompt" ? "info" : "warning";
}

async function handleToggle(id: string, enabled: boolean) {
  try {
    await store.toggle(id, enabled);
  } catch (e: any) {
    message.error(e?.message ?? "Toggle failed");
  }
}

async function handleRun(id: string) {
  try {
    await store.runNow(id);
    message.success(t("scheduledTasks.runTriggered"));
    // Refresh logs after a short delay
    setTimeout(() => store.loadLogs(id), 1500);
  } catch (e: any) {
    message.error(e?.message ?? "Run failed");
  }
}

async function toggleLogs(taskId: string) {
  if (expandedLogs.value.has(taskId)) {
    expandedLogs.value.delete(taskId);
  } else {
    expandedLogs.value.add(taskId);
    if (!store.logs[taskId]) {
      logsLoading.value.add(taskId);
      try {
        await store.loadLogs(taskId);
      } catch (e: any) {
        message.error(e?.message ?? "Load logs failed");
      } finally {
        logsLoading.value.delete(taskId);
      }
    }
  }
}

function handleEdit(task: ScheduledTaskDto) {
  editTask.value = task;
  showCreate.value = true;
}

async function handleSubmit(data: {
  name: string; description: string; cronExpression: string;
  taskType: string; payload: string; enabled: boolean;
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
    await store.remove(deleteTarget.value);
    message.success(t("file.deleted"));
  } catch (e: any) {
    message.error(e?.message ?? "Delete failed");
  } finally {
    deleteTarget.value = null;
  }
}

function logStatusIcon(status: string): string {
  switch (status) {
    case "success": return "✓";
    case "failed": return "✗";
    case "running": return "⟳";
    default: return "?";
  }
}

function logStatusClass(status: string): string {
  switch (status) {
    case "success": return "log-status-success";
    case "failed": return "log-status-failed";
    case "running": return "log-status-running";
    default: return "";
  }
}
</script>

<template>
  <div class="tasks-view">
    <!-- Header -->
    <header class="tasks-header">
      <div class="tasks-header-info">
        <h1 class="tasks-title">{{ t('scheduledTasks.title') }}</h1>
        <p class="tasks-subtitle">{{ t('scheduledTasks.subtitle') }}</p>
      </div>
      <div class="tasks-header-actions">
        <NButton size="small" type="primary" @click="showCreate = true; editTask = null">
          {{ t('scheduledTasks.create') }}
        </NButton>
      </div>
    </header>

    <!-- Loading -->
    <div v-if="store.loading" class="tasks-state">
      <NSpin size="medium" />
    </div>

    <!-- Empty -->
    <div v-else-if="store.tasks.length === 0" class="tasks-state">
      <NEmpty :description="t('scheduledTasks.empty')">
        <template #extra>
          <span class="empty-hint">{{ t('scheduledTasks.emptyHint') }}</span>
        </template>
      </NEmpty>
    </div>

    <!-- Task list -->
    <div v-else class="tasks-list">
      <div v-for="task in store.tasks" :key="task.id" class="task-card">
        <div class="task-card-main">
          <!-- Left: info -->
          <div class="task-info">
            <div class="task-name-row">
              <span class="task-name">{{ task.name }}</span>
              <NTag size="tiny" :bordered="false" :type="typeTagType(task.taskType)">
                {{ typeLabel(task.taskType) }}
              </NTag>
            </div>
            <p v-if="task.description" class="task-description">{{ task.description }}</p>
            <div class="task-meta">
              <span class="task-cron">{{ cronToHuman(task.cronExpression) }}</span>
              <span class="task-meta-sep">·</span>
              <span class="task-time">{{ t('scheduledTasks.lastRun') }}: {{ timeAgo(task.lastRunAt) }}</span>
              <span class="task-meta-sep">·</span>
              <span class="task-time">{{ t('scheduledTasks.nextRun') }}: {{ formatDateTime(task.nextRunAt) }}</span>
            </div>
          </div>

          <!-- Right: controls -->
          <div class="task-controls">
            <NSwitch
              :value="task.enabled"
              size="small"
              @update:value="(v: boolean) => handleToggle(task.id, v)"
            />
            <div class="task-actions">
              <NButton size="tiny" quaternary @click="handleRun(task.id)">
                {{ t('scheduledTasks.runNow') }}
              </NButton>
              <NButton size="tiny" quaternary @click="toggleLogs(task.id)">
                {{ t('scheduledTasks.viewLogs') }}
              </NButton>
              <NButton size="tiny" quaternary @click="handleEdit(task)">
                {{ t('scheduledTasks.edit') }}
              </NButton>
              <NButton size="tiny" quaternary type="error" @click="deleteTarget = task.id">
                {{ t('scheduledTasks.delete') }}
              </NButton>
            </div>
          </div>
        </div>

        <!-- Expanded logs -->
        <div v-if="expandedLogs.has(task.id)" class="task-logs">
          <div class="logs-header">{{ t('scheduledTasks.logs') }}</div>
          <div v-if="logsLoading.has(task.id)" class="logs-loading">
            <NSpin size="small" />
          </div>
          <div v-else-if="!store.logs[task.id]?.length" class="logs-empty">
            {{ t('scheduledTasks.noLogs') }}
          </div>
          <div v-else class="logs-list">
            <div v-for="log in store.logs[task.id]" :key="log.id" class="log-item">
              <span class="log-status" :class="logStatusClass(log.status)">
                {{ logStatusIcon(log.status) }}
              </span>
              <span class="log-time">{{ formatDateTime(log.startedAt) }}</span>
              <span class="log-output">{{ log.output || '—' }}</span>
            </div>
          </div>
        </div>
      </div>
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
  </div>
</template>

<style scoped>
.tasks-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: var(--bg-surface);
  overflow: hidden;
}

.tasks-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 32px 48px 24px;
  border-bottom: 1px solid var(--border-color);
}

.tasks-header-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tasks-title {
  font-size: 24px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

.tasks-subtitle {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 0;
}

.tasks-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 60px 0;
}

.empty-hint {
  font-size: 12px;
  color: var(--text-muted);
}

.tasks-list {
  flex: 1;
  overflow-y: auto;
  padding: 24px 48px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.task-card {
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--background-panel);
  transition: all var(--transition-fast);
  overflow: hidden;
}

.task-card:hover {
  border-color: var(--primary-color);
  box-shadow: var(--shadow-md);
}

.task-card-main {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 16px 20px;
  gap: 16px;
}

.task-info {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.task-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.task-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-description {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.task-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted);
}

.task-cron {
  font-weight: 500;
  color: var(--primary-color);
}

.task-meta-sep {
  color: var(--border-color);
}

.task-time {
  font-family: var(--font-mono);
  font-size: 11px;
}

.task-controls {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  flex-shrink: 0;
}

.task-actions {
  display: flex;
  gap: 4px;
}

/* ─── Logs ─── */

.task-logs {
  border-top: 1px solid var(--border-color);
  padding: 12px 20px;
  background: var(--background-page);
}

.logs-header {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.logs-loading,
.logs-empty {
  padding: 12px 0;
  text-align: center;
  font-size: 12px;
  color: var(--text-muted);
}

.logs-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 200px;
  overflow-y: auto;
}

.log-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 4px 0;
  font-size: 12px;
}

.log-status {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  border-radius: 50%;
}

.log-status-success {
  color: var(--success-color);
  background: rgba(34, 197, 94, 0.1);
}

.log-status-failed {
  color: var(--danger-color);
  background: rgba(239, 68, 68, 0.1);
}

.log-status-running {
  color: var(--primary-color);
  background: rgba(0, 184, 148, 0.1);
  animation: pulse 1.5s ease infinite;
}

.log-time {
  flex-shrink: 0;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
  min-width: 64px;
}

.log-output {
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.4;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
</style>
