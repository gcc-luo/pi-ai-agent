<script setup lang="ts">
import { computed, ref } from "vue";
import { NInput, NButton, NSwitch, NSpin, NEmpty, NTag } from "naive-ui";
import { useKbStore } from "../stores/kb.js";
import { useI18n } from "../i18n/index.js";
import type { KbDto } from "@pi-web-ui/shared";
import CreateKbDialog from "./CreateKbDialog.vue";
import ConfirmDialog from "./ConfirmDialog.vue";

const emit = defineEmits<{
  (e: "select", kbId: string): void;
}>();

const kbStore = useKbStore();
const { t } = useI18n();

const searchQuery = ref("");
const showCreateDialog = ref(false);
const editKb = ref<KbDto | undefined>(undefined);
const deleteTarget = ref<KbDto | null>(null);

const filteredKbs = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return kbStore.knowledgeBases;
  return kbStore.knowledgeBases.filter((kb) =>
    kb.name.toLowerCase().includes(q),
  );
});

function openCreate() {
  editKb.value = undefined;
  showCreateDialog.value = true;
}

function openEdit(kb: KbDto) {
  editKb.value = kb;
  showCreateDialog.value = true;
}

async function handleToggleEnabled(kb: KbDto, enabled: boolean) {
  try {
    await kbStore.update(kb.id, { enabled });
  } catch (e: any) {
    console.error("Failed to toggle KB:", e);
  }
}

function requestDelete(kb: KbDto) {
  deleteTarget.value = kb;
}

async function confirmDelete() {
  if (!deleteTarget.value) return;
  try {
    await kbStore.remove(deleteTarget.value.id);
  } catch (e: any) {
    console.error("Failed to delete KB:", e);
  } finally {
    deleteTarget.value = null;
  }
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
</script>

<template>
  <div class="kb-list-page">
    <header class="kb-header">
      <div class="kb-header-text">
        <h1 class="kb-title">{{ t('kb.title') }}</h1>
        <p class="kb-subtitle">{{ t('kb.subtitle') }}</p>
      </div>
      <NButton type="primary" size="small" @click="openCreate">
        {{ t('kb.newButton') }}
      </NButton>
    </header>

    <div class="kb-toolbar">
      <NInput
        v-model:value="searchQuery"
        size="small"
        :placeholder="t('kb.searchNamePlaceholder')"
        clearable
        class="kb-search-input"
      />
    </div>

    <div class="kb-body">
      <div v-if="kbStore.loading && !kbStore.knowledgeBases.length" class="kb-state">
        <NSpin size="small" />
      </div>
      <div v-else-if="!kbStore.knowledgeBases.length" class="kb-state empty">
        <NEmpty :description="t('kb.empty')">
          <template #extra>
            <NButton size="small" type="primary" @click="openCreate">{{ t('kb.createFirst') }}</NButton>
          </template>
        </NEmpty>
      </div>
      <div v-else-if="!filteredKbs.length" class="kb-state empty">
        <NEmpty :description="t('kb.noMatch')" />
      </div>
      <ul v-else class="kb-card-list">
        <li
          v-for="kb in filteredKbs"
          :key="kb.id"
          class="kb-card"
          @click="emit('select', kb.id)"
        >
          <div class="kb-card-head">
            <span class="kb-card-name truncate">{{ kb.name }}</span>
            <NTag
              size="tiny"
              :type="kb.enabled ? 'success' : 'default'"
              round
            >{{ kb.enabled ? t('kb.enabled') : t('kb.disabled') }}</NTag>
          </div>
          <p class="kb-card-desc">{{ kb.description || t('kb.noDescription') }}</p>
          <div class="kb-card-stats">
            <span class="kb-stat">{{ t('kb.fileCount', { count: kb.fileCount }) }}</span>
            <span class="kb-stat">{{ t('kb.searchableFileCount', { count: kb.searchableFileCount }) }}</span>
            <span class="kb-stat">{{ t('kb.chunkCount', { count: kb.chunkCount }) }}</span>
            <span v-if="kb.failedFileCount > 0" class="kb-stat kb-stat-fail">{{ t('kb.failedFileCount', { count: kb.failedFileCount }) }}</span>
          </div>
          <div class="kb-card-foot">
            <span class="kb-card-time">{{ formatTime(kb.updatedAt) }}</span>
            <div class="kb-card-actions" @click.stop>
              <NSwitch
                :value="kb.enabled"
                size="small"
                @update:value="(v: boolean) => handleToggleEnabled(kb, v)"
              />
              <button class="kb-action-btn" :title="t('kb.edit')" @click="openEdit(kb)">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M10.5 1.5l2 2L4.5 11.5H2.5v-2L10.5 1.5z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </button>
              <button class="kb-action-btn kb-action-danger" :title="t('kb.delete')" @click="requestDelete(kb)">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M3 4h8l-.7 7.3a1 1 0 01-1 .7H4.7a1 1 0 01-1-.7L3 4zm2-2h4m-6 2V3a1 1 0 011-1h6a1 1 0 011 1v1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </button>
            </div>
          </div>
        </li>
      </ul>
    </div>

    <CreateKbDialog
      :show="showCreateDialog"
      :edit-kb="editKb"
      @close="showCreateDialog = false"
      @saved="showCreateDialog = false"
    />
    <ConfirmDialog
      :show="deleteTarget !== null"
      :title="t('kb.deleteTitle')"
      :message="t('kb.deleteConfirm', { name: deleteTarget?.name ?? '' })"
      :confirm-label="t('kb.delete')"
      :cancel-label="t('kb.create.cancel')"
      :danger="true"
      @close="deleteTarget = null"
      @confirm="confirmDelete"
    />
  </div>
</template>

<style scoped>
.kb-list-page {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ─── Header ─── */
.kb-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 32px 48px 24px;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}
.kb-header-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.kb-title {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  color: var(--text-primary);
}
.kb-subtitle {
  margin: 0;
  font-size: 13px;
  color: var(--text-secondary);
}

/* ─── Toolbar ─── */
.kb-toolbar {
  padding: 16px 48px 0;
  flex-shrink: 0;
}
.kb-search-input {
  max-width: 360px;
}

/* ─── Body ─── */
.kb-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 48px 24px;
}
.kb-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 200px;
  color: var(--text-muted);
  font-size: 13px;
}
.kb-state.empty {
  flex-direction: column;
  gap: 12px;
}

/* ─── Card grid ─── */
.kb-card-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 12px;
}
.kb-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 16px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  cursor: pointer;
  transition: all var(--transition-fast);
}
.kb-card:hover {
  border-color: var(--accent);
  background: var(--bg-elevated);
}
.kb-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.kb-card-name {
  font-family: var(--font-mono);
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  flex: 1;
  min-width: 0;
}
.kb-card-desc {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.kb-card-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.kb-stat {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
}
.kb-stat-fail {
  color: var(--rose);
}
.kb-card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 4px;
}
.kb-card-time {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-faint);
}
.kb-card-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.kb-action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
}
.kb-action-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.kb-action-danger:hover {
  color: var(--rose);
}

.truncate {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
