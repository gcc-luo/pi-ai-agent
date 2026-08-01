<script setup lang="ts">
import { computed, ref, onMounted } from "vue";
import { useMessage } from "naive-ui";
import { useTrashStore } from "../stores/trash.js";
import { useProjectStore } from "../stores/project.js";
import { useSessionStore } from "../stores/session.js";
import { useI18n } from "../i18n/index.js";
import ConfirmDialog from "./ConfirmDialog.vue";
import type { TrashItemDto } from "@pi-web-ui/shared";

const trashStore = useTrashStore();
const projectStore = useProjectStore();
const sessionStore = useSessionStore();
const { t } = useI18n();
const message = useMessage();

const emit = defineEmits<{
  (e: "restore-project", projectId: string): void;
}>();

// Must stay in sync with the server-side TRASH_RETENTION_DAYS default (30d).
const RETENTION_DAYS = 30;

const showEmptyConfirm = ref(false);
const showBatchDestroyConfirm = ref(false);
const itemPendingDestroy = ref<TrashItemDto | null>(null);
const selectedKeys = ref<string[]>([]);
const collapsedProjectIds = ref(new Set<string>());

// Search + type filter
const searchQuery = ref("");
const kindFilter = ref<"all" | "project" | "session">("all");

type ProjectNode = {
  projectId: string;
  name: string;
  project: TrashItemDto | null;
  sessions: TrashItemDto[];
  latestDeletedAt: number;
};

// 每次进入回收站视图时都重新加载数据，确保显示最新内容
onMounted(() => {
  trashStore.load();
});

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t("trash.time.justNow");
  if (mins < 60) return t("trash.time.minutesAgo", { n: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t("trash.time.hoursAgo", { n: hours });
  const days = Math.floor(hours / 24);
  if (days < 30) return t("trash.time.daysAgo", { n: days });
  return new Date(ts).toLocaleDateString("zh-CN");
}

function formatFullTime(ts: number): string {
  return new Date(ts).toLocaleString();
}

/** Days remaining before the server auto-purges this item. */
function retentionDaysLeft(deletedAt: number): number {
  const expiresAt = deletedAt + RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return Math.max(0, Math.ceil((expiresAt - Date.now()) / (24 * 60 * 60 * 1000)));
}

function itemKey(item: TrashItemDto) {
  return `${item.kind}:${item.id}`;
}

const selectedKeySet = computed(() => new Set(selectedKeys.value));
const selectedItems = computed(() =>
  trashStore.items.filter((item) => selectedKeySet.value.has(itemKey(item))),
);
const selectedCount = computed(() => selectedItems.value.length);

const filteredItems = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  return trashStore.items.filter((item) => {
    if (kindFilter.value !== "all" && item.kind !== kindFilter.value) return false;
    if (!q) return true;
    return (
      item.name.toLowerCase().includes(q) ||
      (item.subtitle ?? "").toLowerCase().includes(q)
    );
  });
});

const projectNodes = computed<ProjectNode[]>(() => {
  const items = filteredItems.value;
  const nodes = new Map<string, ProjectNode>();

  for (const item of items) {
    if (item.kind !== "project") continue;
    nodes.set(item.id, {
      projectId: item.id,
      name: item.name,
      project: item,
      sessions: [],
      latestDeletedAt: item.deletedAt,
    });
  }

  for (const item of items) {
    if (item.kind !== "session") continue;
    let node = nodes.get(item.projectId);
    if (!node) {
      node = {
        projectId: item.projectId,
        name: item.subtitle || t("trash.unnamedProject"),
        project: null,
        sessions: [],
        latestDeletedAt: item.deletedAt,
      };
      nodes.set(item.projectId, node);
    }
    node.sessions.push(item);
    node.latestDeletedAt = Math.max(node.latestDeletedAt, item.deletedAt);
  }

  return [...nodes.values()]
    .map((node) => ({
      ...node,
      sessions: [...node.sessions].sort((a, b) => b.deletedAt - a.deletedAt),
    }))
    .sort((a, b) => b.latestDeletedAt - a.latestDeletedAt);
});

const isFiltering = computed(
  () => searchQuery.value.trim() !== "" || kindFilter.value !== "all",
);

function nodeItems(node: ProjectNode) {
  return node.project ? [node.project, ...node.sessions] : node.sessions;
}

function isSelected(item: TrashItemDto) {
  return selectedKeySet.value.has(itemKey(item));
}

function isNodeSelected(node: ProjectNode) {
  const items = nodeItems(node);
  return items.length > 0 && items.every(isSelected);
}

function isNodeIndeterminate(node: ProjectNode) {
  const items = nodeItems(node);
  return items.some(isSelected) && !isNodeSelected(node);
}

function setSelected(items: TrashItemDto[], selected: boolean) {
  const next = new Set(selectedKeys.value);
  for (const item of items) {
    if (selected) next.add(itemKey(item));
    else next.delete(itemKey(item));
  }
  selectedKeys.value = [...next];
}

function toggleNodeSelection(node: ProjectNode, selected: boolean) {
  setSelected(nodeItems(node), selected);
}

function toggleItemSelection(item: TrashItemDto, selected: boolean) {
  setSelected([item], selected);
}

function toggleProject(node: ProjectNode) {
  const next = new Set(collapsedProjectIds.value);
  if (next.has(node.projectId)) next.delete(node.projectId);
  else next.add(node.projectId);
  collapsedProjectIds.value = next;
}

function isExpanded(node: ProjectNode) {
  return !collapsedProjectIds.value.has(node.projectId);
}

/** Post-restore bookkeeping shared by single & batch restore. */
async function afterRestore(items: TrashItemDto[]) {
  // 恢复项目后，项目侧边栏的数据不会通过回收站 store 自动更新；
  // 即使项目没有会话，也必须刷新项目列表才能重新显示。
  await projectStore.loadAll();

  const restoredSessionProjectIds = new Set(
    items.filter((item) => item.kind === "session").map((item) => item.projectId),
  );
  if (projectStore.current && restoredSessionProjectIds.has(projectStore.current.id)) {
    await sessionStore.loadForProject(projectStore.current.id);
  }
}

async function restoreItem(item: TrashItemDto) {
  try {
    await trashStore.restore(item.kind, item.id);
    await afterRestore([item]);
    selectedKeys.value = selectedKeys.value.filter((k) => k !== itemKey(item));
    if (item.kind === "project") {
      message.success(t("trash.restoredProject"), {
        duration: 5000,
        closable: true,
      });
      emit("restore-project", item.id);
    } else {
      message.success(t("trash.restoredSession"));
    }
  } catch (e) {
    message.error((e as Error)?.message ?? t("trash.restoreFailed"));
  }
}

async function destroyItem(item: TrashItemDto) {
  try {
    await trashStore.destroy(item.kind, item.id);
    selectedKeys.value = selectedKeys.value.filter((k) => k !== itemKey(item));
    message.success(t("trash.destroyed"));
  } catch (e) {
    message.error((e as Error)?.message ?? t("trash.destroyFailed"));
  } finally {
    itemPendingDestroy.value = null;
  }
}

async function confirmEmpty() {
  try {
    await trashStore.emptyAll();
    selectedKeys.value = [];
  } catch (e) {
    message.error((e as Error)?.message ?? t("trash.destroyFailed"));
  } finally {
    showEmptyConfirm.value = false;
  }
}

async function restoreSelected() {
  const items = [...selectedItems.value];
  // Run restores concurrently — the per-item API is idempotent.
  const results = await Promise.allSettled(
    items.map((item) => trashStore.restore(item.kind, item.id)),
  );
  const failed = results.filter((r) => r.status === "rejected").length;
  await afterRestore(items);
  selectedKeys.value = [];
  if (failed > 0) {
    message.error(t("trash.restoreFailedCount", { count: failed }));
  } else {
    message.success(t("trash.restoredCount", { count: items.length }));
  }
}

async function confirmDestroySelected() {
  const projectIds = new Set(
    selectedItems.value.filter((item) => item.kind === "project").map((item) => item.id),
  );
  const items = selectedItems.value.filter(
    (item) => item.kind === "project" || !projectIds.has(item.projectId),
  );
  const results = await Promise.allSettled(
    items.map((item) => trashStore.destroy(item.kind, item.id)),
  );
  const failed = results.filter((r) => r.status === "rejected").length;
  selectedKeys.value = [];
  showBatchDestroyConfirm.value = false;
  if (failed > 0) {
    message.error(t("trash.destroyFailedCount", { count: failed }));
  } else {
    message.success(t("trash.destroyed"));
  }
}
</script>

<template>
  <main class="trash-view">
    <header class="trash-header">
      <div class="trash-header-info">
        <h1 class="trash-title">{{ t('trash.title') }}</h1>
        <p class="trash-subtitle">{{ t('trash.subtitle') }}</p>
      </div>
      <button
        v-if="trashStore.count > 0"
        class="empty-btn"
        @click="showEmptyConfirm = true"
      >
        {{ t('trash.empty') }}
      </button>
    </header>

    <div v-if="trashStore.count > 0" class="trash-toolbar">
      <div class="search-box">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" stroke-width="1.4" />
          <path d="M10 10l2.5 2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
        </svg>
        <input
          v-model="searchQuery"
          type="search"
          class="search-input"
          :placeholder="t('trash.searchPlaceholder')"
        />
      </div>
      <div class="kind-filter" role="tablist">
        <button
          v-for="opt in (['all', 'project', 'session'] as const)"
          :key="opt"
          class="kind-filter-btn"
          :class="{ active: kindFilter === opt }"
          role="tab"
          :aria-selected="kindFilter === opt"
          @click="kindFilter = opt"
        >
          {{ t(`trash.filter.${opt}`) }}
        </button>
      </div>
    </div>

    <div v-if="selectedCount > 0" class="selection-toolbar">
      <span>{{ t('trash.selectedCount', { count: selectedCount }) }}</span>
      <div class="selection-actions">
        <button class="action-btn restore-btn" @click="restoreSelected">{{ t('trash.restoreSelected') }}</button>
        <button class="action-btn destroy-btn" @click="showBatchDestroyConfirm = true">{{ t('trash.destroySelected') }}</button>
        <button class="clear-selection-btn" @click="selectedKeys = []">{{ t('trash.clearSelection') }}</button>
      </div>
    </div>

    <div v-if="trashStore.loading" class="trash-loading">
      <span class="loading-spinner"></span>
    </div>

    <div v-else-if="trashStore.count === 0" class="trash-empty">
      <svg class="empty-icon" width="64" height="64" viewBox="0 0 64 64" fill="none">
        <path d="M16 20v28a4 4 0 004 4h24a4 4 0 004-4V20M12 20h40M24 20v-4a2 2 0 012-2h12a2 2 0 012 2v4M24 28v20M40 28v20" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <p class="empty-text">{{ t('trash.emptyState') }}</p>
      <p class="empty-hint">{{ t('trash.emptyStateHint') }}</p>
      <p class="empty-hint">{{ t('trash.emptyStateRetention', { days: RETENTION_DAYS }) }}</p>
    </div>

    <div v-else-if="projectNodes.length === 0 && isFiltering" class="trash-empty">
      <p class="empty-text">{{ t('trash.noResults') }}</p>
      <p class="empty-hint">{{ t('trash.noResultsHint') }}</p>
    </div>

    <div v-else class="trash-list">
      <section v-for="node in projectNodes" :key="node.projectId" class="trash-project-group">
        <div class="tree-row project-row" :class="{ contextual: !node.project }">
          <button class="tree-toggle" :aria-expanded="isExpanded(node)" @click="toggleProject(node)">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" :class="{ collapsed: !isExpanded(node) }">
              <path d="M3 5l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
          <input
            class="tree-checkbox"
            type="checkbox"
            :checked="isNodeSelected(node)"
            :indeterminate="isNodeIndeterminate(node)"
            @change="toggleNodeSelection(node, ($event.target as HTMLInputElement).checked)"
          />
          <div class="tree-item-icon project-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
            </svg>
          </div>
          <div class="tree-item-info">
            <div class="tree-item-header">
              <span class="tree-item-name">{{ node.name }}</span>
              <span class="tree-item-badge">{{ t('trash.kindProject') }}</span>
            </div>
            <div class="tree-item-meta">
              <span v-if="node.project?.subtitle">{{ node.project.subtitle }}</span>
              <span v-else>{{ t('trash.projectSessionCount', { count: node.sessions.length }) }}</span>
              <span v-if="node.project" :title="formatFullTime(node.project.deletedAt)">
                {{ t('trash.deletedAt', { time: formatRelativeTime(node.project.deletedAt) }) }}
              </span>
              <span v-if="node.project" class="retention-hint">
                {{ t('trash.retentionHint', { days: retentionDaysLeft(node.project.deletedAt) }) }}
              </span>
            </div>
          </div>
          <div v-if="node.project" class="tree-item-actions">
            <button class="row-action-btn" @click="restoreItem(node.project!)">{{ t('trash.restore') }}</button>
            <button class="row-action-btn danger" @click="itemPendingDestroy = node.project">{{ t('trash.destroy') }}</button>
          </div>
        </div>

        <div v-show="isExpanded(node)" class="session-children">
          <div v-for="session in node.sessions" :key="session.id" class="tree-row session-row">
            <input
              class="tree-checkbox"
              type="checkbox"
              :checked="isSelected(session)"
              @change="toggleItemSelection(session, ($event.target as HTMLInputElement).checked)"
            />
            <div class="tree-item-icon session-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M4 6a2 2 0 012-2h12a2 2 0 012 2v10a2 2 0 01-2 2H9l-4 4V6z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
              </svg>
            </div>
            <div class="tree-item-info">
              <div class="tree-item-header">
                <span class="tree-item-name">{{ session.name }}</span>
                <span class="tree-item-badge">{{ t('trash.kindSession') }}</span>
              </div>
              <div class="tree-item-meta">
                <span :title="formatFullTime(session.deletedAt)">
                  {{ t('trash.deletedAt', { time: formatRelativeTime(session.deletedAt) }) }}
                </span>
                <span class="retention-hint">
                  {{ t('trash.retentionHint', { days: retentionDaysLeft(session.deletedAt) }) }}
                </span>
              </div>
            </div>
            <div class="tree-item-actions">
              <button class="row-action-btn" @click="restoreItem(session)">{{ t('trash.restore') }}</button>
              <button class="row-action-btn danger" @click="itemPendingDestroy = session">{{ t('trash.destroy') }}</button>
            </div>
          </div>
        </div>
      </section>
    </div>

    <ConfirmDialog
      :show="showEmptyConfirm"
      :title="t('trash.emptyConfirmTitle')"
      :message="t('trash.emptyConfirmMessage')"
      :confirm-label="t('trash.emptyTrash')"
      :cancel-label="t('trash.cancel')"
      danger
      @close="showEmptyConfirm = false"
      @confirm="confirmEmpty"
    />

    <ConfirmDialog
      :show="showBatchDestroyConfirm"
      :title="t('trash.destroyConfirmTitle')"
      :message="t('trash.destroySelectedConfirmMessage', { count: selectedCount })"
      :confirm-label="t('trash.destroyConfirm')"
      :cancel-label="t('trash.cancel')"
      danger
      @close="showBatchDestroyConfirm = false"
      @confirm="confirmDestroySelected"
    />

    <ConfirmDialog
      :show="itemPendingDestroy !== null"
      :title="t('trash.destroyConfirmTitle')"
      :message="t('trash.destroyConfirmMessage', { name: itemPendingDestroy?.name ?? '' })"
      :confirm-label="t('trash.destroyConfirm')"
      :cancel-label="t('trash.cancel')"
      danger
      @close="itemPendingDestroy = null"
      @confirm="itemPendingDestroy && destroyItem(itemPendingDestroy)"
    />
  </main>
</template>

<style scoped>
.trash-view {
  flex: 1;
  /* A flex item's minimum size defaults to its content size. Without this,
     the view grows taller than the viewport when the list is long, so the
     inner .trash-list can never scroll and bottom items are pushed offscreen. */
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-surface);
  overflow: hidden;
}

.trash-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 32px 48px 16px;
  border-bottom: 1px solid var(--border-color);
}

.trash-header-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.trash-title {
  font-size: 24px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

.trash-subtitle {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 0;
}

.empty-btn {
  padding: 8px 16px;
  border: 1px solid var(--danger-color);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--danger-color);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.empty-btn:hover {
  background: var(--danger-color);
  color: white;
}

/* Search + filter toolbar */
.trash-toolbar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 48px;
  border-bottom: 1px solid var(--border-color);
}

.search-box {
  flex: 1;
  max-width: 360px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
  color: var(--text-secondary);
}

.search-box:focus-within {
  border-color: var(--primary-color);
}

.search-input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 13px;
}

.search-input::placeholder {
  color: var(--text-disabled);
}

.kind-filter {
  display: flex;
  gap: 4px;
  padding: 2px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
}

.kind-filter-btn {
  padding: 4px 12px;
  border: none;
  border-radius: calc(var(--radius-sm) - 2px);
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.kind-filter-btn:hover {
  color: var(--text-primary);
}

.kind-filter-btn.active {
  background: var(--primary-color);
  color: white;
}

.trash-loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.selection-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 48px;
  background: var(--accent-dim);
  border-bottom: 1px solid var(--border-color);
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 500;
}

.selection-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.clear-selection-btn {
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
}

.clear-selection-btn:hover {
  color: var(--text-primary);
}

.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--border-color);
  border-top-color: var(--primary-color);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.trash-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 48px;
}

.empty-icon {
  color: var(--text-disabled);
}

.empty-text {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.empty-hint {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 0;
}

.trash-list {
  flex: 1;
  min-height: 0; /* allow the flex child to shrink so overflow-y can scroll */
  overflow-y: auto;
  padding: 24px 48px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.trash-project-group {
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--background-panel);
  overflow: hidden;
  flex-shrink: 0;
}

.tree-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 60px;
  padding: 10px 16px;
  transition: all var(--transition-fast);
}

.tree-row:hover {
  background: var(--bg-elevated);
}

.project-row {
  background: var(--bg-surface);
}

.project-row.contextual {
  background: var(--bg-elevated);
}

.session-children {
  border-top: 1px solid var(--border-color);
}

.session-row {
  position: relative;
  padding-left: 54px;
  border-top: 1px solid var(--border-color);
}

/* Tree connector drawn as a fixed pseudo-element so it never affects the
   row's own box model — keeps every session row the same height regardless
   of content, avoiding the misalignment seen when rows expand. */
.session-row::before {
  content: "";
  position: absolute;
  left: 26px;
  top: 0;
  bottom: 50%;
  width: 17px;
  border-left: 1px solid var(--border-color);
  border-bottom: 1px solid var(--border-color);
  border-bottom-left-radius: 4px;
  pointer-events: none;
}

.session-row:first-child {
  border-top: none;
}

.tree-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.tree-toggle svg {
  transition: transform var(--transition-fast);
}

.tree-toggle svg.collapsed {
  transform: rotate(-90deg);
}

.tree-checkbox {
  width: 15px;
  height: 15px;
  margin: 0;
  accent-color: var(--primary-color);
  cursor: pointer;
  flex-shrink: 0;
}


.tree-item-icon {
  flex-shrink: 0;
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
  color: var(--text-secondary);
}

.project-icon {
  background: var(--accent-dim);
  color: var(--primary-color);
}

.session-icon {
  width: 30px;
  height: 30px;
}

.tree-item-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tree-item-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tree-item-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tree-item-badge {
  flex-shrink: 0;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--bg-elevated);
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 500;
}

.tree-item-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  color: var(--text-secondary);
}

.retention-hint {
  color: var(--text-disabled);
}

/* Row-level actions, revealed on hover */
.tree-item-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity var(--transition-fast);
}

.tree-row:hover .tree-item-actions,
.tree-item-actions:focus-within {
  opacity: 1;
}

.row-action-btn {
  padding: 5px 12px;
  border: 1px solid var(--primary-color);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--primary-color);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.row-action-btn:hover {
  background: var(--primary-color);
  color: white;
}

.row-action-btn.danger {
  border-color: var(--danger-color);
  color: var(--danger-color);
}

.row-action-btn.danger:hover {
  background: var(--danger-color);
  color: white;
}

.action-btn {
  padding: 6px 12px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition-fast);
  border: 1px solid transparent;
}

.restore-btn {
  background: var(--primary-light);
  color: var(--primary-color);
  border-color: var(--primary-color);
}

.restore-btn:hover {
  background: var(--primary-color);
  color: white;
}

.destroy-btn {
  background: transparent;
  color: var(--danger-color);
  border-color: var(--danger-color);
}

.destroy-btn:hover {
  background: var(--danger-color);
  color: white;
}
</style>
