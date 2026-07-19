<script setup lang="ts">
import { computed, watch } from "vue";
import { useKbBindingStore } from "../stores/kb-binding.js";
import { useKbStore } from "../stores/kb.js";
import { useKbFileStore } from "../stores/kb-file.js";
import { useI18n } from "../i18n/index.js";

const props = defineProps<{
  sessionId: string;
}>();

const kbStore = useKbStore();
const kbBindingStore = useKbBindingStore();
const kbFileStore = useKbFileStore();
const { t } = useI18n();

const bindings = computed(() => kbBindingStore.getForSession(props.sessionId));

// 绑定变化时预拉一次可搜索文件，保证刷新页面后 banner 计数正确
watch(
  () => bindings.value.map((b) => b.kbId),
  (kbIds, prevKbIds) => {
    const prev = new Set(prevKbIds ?? []);
    for (const id of kbIds) {
      if (!prev.has(id)) kbFileStore.loadSearchableFiles(id);
    }
  },
  { immediate: true },
);

const summary = computed(() => {
  const kbIds = new Set(bindings.value.map((b) => b.kbId));
  const fileCount = bindings.value.reduce((acc, b) => {
    if (b.fileFilter && b.fileFilter.length > 0) {
      return acc + b.fileFilter.length;
    }
    // Count all searchable files if no filter
    return acc + kbFileStore.searchableFiles(b.kbId).length;
  }, 0);

  return { kbCount: kbIds.size, fileCount };
});

const kbNames = computed(() => {
  return bindings.value.map((b) => {
    const kb = kbStore.knowledgeBases.find((k) => k.id === b.kbId);
    return kb?.name ?? b.kbId;
  });
});

function dismiss() {
  // Save empty bindings to clear
  kbBindingStore.save(props.sessionId, []);
}
</script>

<template>
  <div v-if="bindings.length > 0" class="kb-banner">
    <svg width="14" height="14" viewBox="0 0 18 18" fill="none" class="kb-banner-icon">
      <path d="M3 3h4a2 2 0 012 2v10a1.5 1.5 0 00-1.5-1.5H3V3z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
      <path d="M15 3h-4a2 2 0 00-2 2v10a1.5 1.5 0 011.5-1.5H15V3z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
    </svg>
    <span class="kb-banner-text">
      {{ t('kb.chat.banner', { kbCount: summary.kbCount, fileCount: summary.fileCount }) }}
    </span>
    <span class="kb-banner-names">{{ kbNames.join(', ') }}</span>
    <button class="kb-banner-dismiss" @click="dismiss" :title="t('kb.chat.banner.dismiss')">
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
        <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.kb-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  background: var(--accent-dim);
  border: 1px dashed var(--accent);
  color: var(--accent);
  font-size: 11px;
}
.kb-banner-icon {
  flex-shrink: 0;
}
.kb-banner-text {
  font-family: var(--font-mono);
  font-weight: 600;
  white-space: nowrap;
}
.kb-banner-names {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 10px;
}
.kb-banner-dismiss {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--accent);
  cursor: pointer;
  flex-shrink: 0;
  opacity: 0.6;
  transition: all var(--transition-fast);
}
.kb-banner-dismiss:hover {
  opacity: 1;
  background: rgba(0, 184, 148, 0.15);
}
</style>
