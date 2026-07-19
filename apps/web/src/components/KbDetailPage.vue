<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { NTabs, NTabPane, NSpin, NTag } from "naive-ui";
import { useKbStore } from "../stores/kb.js";
import { useKbFileStore } from "../stores/kb-file.js";
import { useI18n } from "../i18n/index.js";
import KbFileTab from "./KbFileTab.vue";
import KbSearchTab from "./KbSearchTab.vue";
import KbSettingsTab from "./KbSettingsTab.vue";

const props = defineProps<{
  kbId: string;
}>();
const emit = defineEmits<{
  (e: "back"): void;
  (e: "deleted"): void;
}>();

const kbStore = useKbStore();
const kbFileStore = useKbFileStore();
const { t } = useI18n();
const activeTab = ref("files");
const loading = ref(false);

async function loadData() {
  loading.value = true;
  try {
    const kb = await import("../api/client.js").then((m) => m.api.getKnowledgeBase(props.kbId));
    kbStore.setCurrent(kb);
    await kbFileStore.loadForKb(props.kbId);
  } catch (e: any) {
    console.error("Failed to load KB detail:", e);
  } finally {
    loading.value = false;
  }
}

onMounted(loadData);

watch(() => props.kbId, () => {
  activeTab.value = "files";
  loadData();
});

function handleDeleted() {
  emit("deleted");
}
</script>

<template>
  <div class="kb-detail-page">
    <header class="kb-detail-header">
      <button class="kb-back-btn" :title="t('kb.backToList')" @click="emit('back')">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      <div v-if="kbStore.current" class="kb-detail-info">
        <h1 class="kb-detail-title">{{ kbStore.current.name }}</h1>
        <div class="kb-detail-stats">
          <NTag size="tiny" round>{{ t('kb.fileCount', { count: kbStore.current.fileCount }) }}</NTag>
          <NTag size="tiny" round>{{ t('kb.chunkCount', { count: kbStore.current.chunkCount }) }}</NTag>
          <NTag v-if="kbStore.current.failedFileCount > 0" size="tiny" type="error" round>
            {{ t('kb.failedFileCount', { count: kbStore.current.failedFileCount }) }}
          </NTag>
          <NTag size="tiny" :type="kbStore.current.enabled ? 'success' : 'default'" round>
            {{ kbStore.current.enabled ? t('kb.enabled') : t('kb.disabled') }}
          </NTag>
        </div>
      </div>
      <div v-else class="kb-detail-info">
        <h1 class="kb-detail-title">{{ t('kb.loading') }}</h1>
      </div>
    </header>

    <div v-if="loading" class="kb-detail-loading">
      <NSpin size="medium" />
    </div>
    <template v-else>
      <NTabs v-model:value="activeTab" type="line" class="kb-detail-tabs">
        <NTabPane name="files" :tab="t('kb.tabFiles')">
          <KbFileTab :kb-id="kbId" />
        </NTabPane>
        <NTabPane name="search" :tab="t('kb.tabSearch')">
          <KbSearchTab :kb-id="kbId" />
        </NTabPane>
        <NTabPane name="settings" :tab="t('kb.tabSettings')">
          <KbSettingsTab :kb-id="kbId" @deleted="handleDeleted" />
        </NTabPane>
      </NTabs>
    </template>
  </div>
</template>

<style scoped>
.kb-detail-page {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ─── Header ─── */
.kb-detail-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 28px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-deep);
  flex-shrink: 0;
}
.kb-back-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
  flex-shrink: 0;
}
.kb-back-btn:hover {
  border-color: var(--accent);
  color: var(--text-primary);
  background: var(--bg-hover);
}
.kb-detail-info {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.kb-detail-title {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.kb-detail-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

/* ─── Loading ─── */
.kb-detail-loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* ─── Tabs ─── */
.kb-detail-tabs {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.kb-detail-tabs :deep(.n-tabs-nav) {
  padding: 0 28px;
  margin-bottom: 0;
  background: var(--bg-deep);
}
.kb-detail-tabs :deep(.n-tab-pane) {
  flex: 1;
  overflow: hidden;
  padding: 0;
}
</style>
