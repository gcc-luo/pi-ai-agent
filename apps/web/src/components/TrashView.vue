<script setup lang="ts">
import { computed, ref, onMounted } from "vue";
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

const showEmptyConfirm = ref(false);
const showBatchDestroyConfirm = ref(false);
const selectedKeys = ref<string[]>([]);
const collapsedProjectIds = ref(new Set<string>());

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
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(ts).toLocaleDateString("zh-CN");
}

function itemKey(item: TrashItemDto) {
  return `${item.kind}:${item.id}`;
}

const selectedKeySet = computed(() => new Set(selectedKeys.value));
const selectedItems = computed(() =>
  trashStore.items.filter((item) => selectedKeySet.value.has(itemKey(item))),
);
const selectedCount = computed(() => selectedItems.value.length);

const projectNodes = computed<ProjectNode[]>(() => {
  const nodes = new Map<string, ProjectNode>();

  for (const item of trashStore.items) {
    if (item.kind !== "project") continue;
    nodes.set(item.id, {
      projectId: item.id,
      name: item.name,
      project: item,
      sessions: [],
      latestDeletedAt: item.deletedAt,
    });
  }

  for (const item of trashStore.items) {
    if (item.kind !== "session") continue;
    let node = nodes.get(item.projectId);
    if (!node) {
      node = {
        projectId: item.projectId,
        name: item.subtitle || "未命名项目",
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

async function confirmEmpty() {
  await trashStore.emptyAll();
  selectedKeys.value = [];
  showEmptyConfirm.value = false;
}

async function restoreSelected() {
  const items = [...selectedItems.value];
  for (const item of items) {
    await trashStore.restore(item.kind, item.id);
  }
  // 恢复项目后，项目侧边栏的数据不会通过回收站 store 自动更新；
  // 即使项目没有会话，也必须刷新项目列表才能重新显示。
  await projectStore.loadAll();

  const restoredSessionProjectIds = new Set(
    items.filter((item) => item.kind === "session").map((item) => item.projectId),
  );
  if (projectStore.current && restoredSessionProjectIds.has(projectStore.current.id)) {
    await sessionStore.loadForProject(projectStore.current.id);
  }
  selectedKeys.value = [];
}

async function confirmDestroySelected() {
  const projectIds = new Set(
    selectedItems.value.filter((item) => item.kind === "project").map((item) => item.id),
  );
  const items = selectedItems.value.filter(
    (item) => item.kind === "project" || !projectIds.has(item.projectId),
  );
  for (const item of items) {
    await trashStore.destroy(item.kind, item.id);
  }
  selectedKeys.value = [];
  showBatchDestroyConfirm.value = false;
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
              <span v-if="node.project">{{ t('trash.deletedAt', { time: formatRelativeTime(node.project.deletedAt) }) }}</span>
            </div>
          </div>
        </div>

        <div v-show="isExpanded(node)" class="session-children">
          <div v-for="session in node.sessions" :key="session.id" class="tree-row session-row">
            <span class="tree-branch" aria-hidden="true" />
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
              <div class="tree-item-meta">{{ t('trash.deletedAt', { time: formatRelativeTime(session.deletedAt) }) }}</div>
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
  </main>
</template>

<style scoped>
.trash-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: var(--background-primary);
  overflow: hidden;
}

.trash-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 32px 48px 24px;
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
  background: #e8faf5;
  border-bottom: 1px solid #b9eadb;
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
  overflow-y: auto;
  padding: 24px 48px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.trash-project-group {
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--background-panel);
  overflow: hidden;
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
  background: var(--background-secondary);
}

.project-row {
  background: #fbfcfd;
}

.project-row.contextual {
  background: #f8fafc;
}

.session-children {
  border-top: 1px solid var(--border-color);
}

.session-row {
  position: relative;
  padding-left: 54px;
  border-top: 1px solid var(--border-color);
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

.tree-branch {
  position: absolute;
  left: 26px;
  top: 0;
  bottom: 50%;
  width: 17px;
  border-left: 1px solid var(--border-color);
  border-bottom: 1px solid var(--border-color);
  border-bottom-left-radius: 4px;
}

.tree-item-icon {
  flex-shrink: 0;
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  background: var(--background-secondary);
  color: var(--text-secondary);
}

.project-icon {
  background: #e8faf5;
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
  background: var(--background-secondary);
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
