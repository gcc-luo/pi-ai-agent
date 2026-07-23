<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { NInput, NButton, NTabs, NTabPane, NTag, NSpin, NEmpty, useMessage } from "naive-ui";
import { useExpertStore } from "../stores/expert.js";
import { useProjectStore } from "../stores/project.js";
import { useSessionStore } from "../stores/session.js";
import { useI18n } from "../i18n/index.js";
import type { ExpertCategory } from "@pi-web-ui/shared";
import CreateExpertDialog from "./CreateExpertDialog.vue";
import ConfirmDialog from "./ConfirmDialog.vue";

const expertStore = useExpertStore();
const projectStore = useProjectStore();
const sessionStore = useSessionStore();
const { t } = useI18n();
const message = useMessage();

const emit = defineEmits<{
  "summon-session": [payload: { projectId: string; sessionId: string }];
}>();

const showCreate = ref(false);
const editExpertId = ref<string | null>(null);
const deleteTarget = ref<string | null>(null);

const categoryOptions = computed(() => [
  { key: null, label: t("expert.category.all") },
  { key: "development" as ExpertCategory, label: t("expert.category.development") },
  { key: "design" as ExpertCategory, label: t("expert.category.design") },
  { key: "data" as ExpertCategory, label: t("expert.category.data") },
  { key: "marketing" as ExpertCategory, label: t("expert.category.marketing") },
  { key: "product" as ExpertCategory, label: t("expert.category.product") },
  { key: "finance" as ExpertCategory, label: t("expert.category.finance") },
  { key: "legal" as ExpertCategory, label: t("expert.category.legal") },
  { key: "operations" as ExpertCategory, label: t("expert.category.operations") },
]);

onMounted(() => {
  expertStore.loadAll();
});

function onCategoryChange(key: string | null) {
  expertStore.setCategory(key as ExpertCategory | null);
}

function onSearchInput(v: string) {
  expertStore.setSearch(v);
}

function categoryLabel(cat: ExpertCategory): string {
  return t(`expert.category.${cat}`);
}

function requestDelete(id: string) {
  deleteTarget.value = id;
}

async function confirmDelete() {
  if (!deleteTarget.value) return;
  try {
    await expertStore.remove(deleteTarget.value);
    message.success(t("file.deleted"));
  } catch (e: any) {
    message.error(e?.message ?? "Delete failed");
  } finally {
    deleteTarget.value = null;
  }
}

async function handleSummon(expertId: string) {
  // Use the current project if available; otherwise fall back to the first
  // project in the list so the user doesn't need to be on the chat view.
  const projectId = projectStore.current?.id ?? projectStore.projects[0]?.id;
  if (!projectId) {
    message.warning(t("expert.noProject"));
    return;
  }
  try {
    const session = await expertStore.summon(expertId, projectId);
    // Emit to App.vue so it can switch the nav to chat, select the project
    // and session, and open the conversation with the expert.
    emit("summon-session", { projectId, sessionId: session.id });
    message.success(t("expert.summoned"));
  } catch (e: any) {
    message.error(e?.message ?? "Summon failed");
  }
}
</script>

<template>
  <div class="expert-view">
    <!-- Header -->
    <header class="expert-header">
      <div class="expert-header-info">
        <h1 class="expert-title">{{ t('expert.title') }}</h1>
        <p class="expert-subtitle">{{ t('expert.subtitle') }}</p>
      </div>
      <div class="expert-header-actions">
        <NInput
          :value="expertStore.searchQuery"
          :placeholder="t('expert.search')"
          clearable
          size="small"
          class="expert-search"
          @update:value="onSearchInput"
        />
        <NButton size="small" type="primary" @click="showCreate = true">
          {{ t('expert.create') }}
        </NButton>
      </div>
    </header>

    <!-- Category tabs -->
    <NTabs
      :value="expertStore.activeCategory ?? 'all'"
      type="line"
      animated
      class="expert-tabs"
      @update:value="(v: string) => onCategoryChange(v === 'all' ? null : v)"
    >
      <NTabPane v-for="opt in categoryOptions" :key="opt.key ?? 'all'" :name="opt.key ?? 'all'" :tab="opt.label" />
    </NTabs>

    <!-- Loading -->
    <div v-if="expertStore.loading" class="expert-state">
      <NSpin size="medium" />
    </div>

    <!-- Empty -->
    <div v-else-if="expertStore.filteredExperts.length === 0" class="expert-state">
      <NEmpty :description="t('expert.empty')" />
    </div>

    <!-- Expert grid -->
    <div v-else class="expert-grid">
      <div v-for="expert in expertStore.filteredExperts" :key="expert.id" class="expert-card">
        <div class="expert-card-header">
          <span class="expert-icon">{{ expert.icon }}</span>
          <div class="expert-card-title">
            <span class="expert-name">{{ expert.name }}</span>
            <NTag size="tiny" :bordered="false" type="info">{{ categoryLabel(expert.category) }}</NTag>
          </div>
        </div>
        <p class="expert-description">{{ expert.description }}</p>
        <div v-if="expert.tags.length" class="expert-tags">
          <NTag v-for="tag in expert.tags" :key="tag" size="tiny" :bordered="false">{{ tag }}</NTag>
        </div>
        <div class="expert-card-actions">
          <NButton size="tiny" type="primary" @click="handleSummon(expert.id)">
            {{ t('expert.summon') }}
          </NButton>
          <NButton v-if="!expert.isPreset" size="tiny" quaternary @click="editExpertId = expert.id">
            {{ t('expert.edit') }}
          </NButton>
          <NButton v-if="!expert.isPreset" size="tiny" quaternary type="error" @click="requestDelete(expert.id)">
            {{ t('expert.delete') }}
          </NButton>
        </div>
      </div>
    </div>

    <!-- Create / Edit Dialog -->
    <CreateExpertDialog
      :show="showCreate || editExpertId !== null"
      :expert-id="editExpertId"
      @close="showCreate = false; editExpertId = null"
      @saved="showCreate = false; editExpertId = null; expertStore.loadAll()"
    />

    <!-- Delete Confirm -->
    <ConfirmDialog
      :show="deleteTarget !== null"
      :title="t('expert.deleteConfirmTitle')"
      :message="t('expert.deleteConfirmMessage')"
      :confirm-label="t('expert.delete')"
      :cancel-label="t('file.deleteCancel')"
      :danger="true"
      @close="deleteTarget = null"
      @confirm="confirmDelete"
    />
  </div>
</template>

<style scoped>
.expert-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: var(--bg-surface);
  overflow: hidden;
}

.expert-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 32px 48px 24px;
  border-bottom: 1px solid var(--border-color);
}

.expert-header-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.expert-title {
  font-size: 24px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

.expert-subtitle {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 0;
}

.expert-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.expert-search {
  width: 200px;
}

.expert-tabs {
  padding: 0 48px;
}

.expert-tabs :deep(.n-tabs-nav) {
  border-bottom: 1px solid var(--border-color);
}

.expert-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 60px 0;
}

.expert-grid {
  flex: 1;
  overflow-y: auto;
  padding: 24px 48px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
  align-content: start;
}

.expert-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--background-panel);
  transition: all var(--transition-fast);
}

.expert-card:hover {
  border-color: var(--primary-color);
  box-shadow: var(--shadow-md);
}

.expert-card-header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.expert-icon {
  font-size: 32px;
  line-height: 1;
  flex-shrink: 0;
}

.expert-card-title {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.expert-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.expert-description {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.expert-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.expert-card-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: auto;
}
</style>
