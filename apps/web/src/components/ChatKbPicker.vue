<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { NPopover, NCheckbox } from "naive-ui";
import { useKbStore } from "../stores/kb.js";
import { useKbFileStore } from "../stores/kb-file.js";
import { useKbBindingStore } from "../stores/kb-binding.js";
import { useI18n } from "../i18n/index.js";
import type { KbDto } from "@pi-web-ui/shared";

const props = defineProps<{
  sessionId: string;
}>();

const emit = defineEmits<{
  (e: "updated"): void;
}>();

const kbStore = useKbStore();
const kbFileStore = useKbFileStore();
const kbBindingStore = useKbBindingStore();
const { t } = useI18n();

const showPopover = ref(false);
const expandedKbId = ref<string | null>(null);

const enabledKbs = computed(() => kbStore.knowledgeBases.filter((kb) => kb.enabled));

const selectedKbIds = computed(() => {
  const bindings = kbBindingStore.getForSession(props.sessionId);
  return new Set(bindings.map((b) => b.kbId));
});

onMounted(async () => {
  await kbStore.loadAll();
});

watch(
  () => props.sessionId,
  async (id) => {
    if (id) await kbBindingStore.load(id);
  },
  { immediate: true },
);

async function toggleKb(kb: KbDto) {
  const bindings = kbBindingStore.getForSession(props.sessionId);
  const isSelected = selectedKbIds.value.has(kb.id);

  if (isSelected) {
    // Remove
    const newBindings = bindings.filter((b) => b.kbId !== kb.id);
    await kbBindingStore.save(props.sessionId, newBindings.map((b) => ({ kbId: b.kbId, fileFilter: b.fileFilter })));
  } else {
    // Add (max 10)
    if (bindings.length >= 10) return;
    const newBindings = [...bindings.map((b) => ({ kbId: b.kbId, fileFilter: b.fileFilter })), { kbId: kb.id, fileFilter: null }];
    await kbBindingStore.save(props.sessionId, newBindings);
    // Pre-load files for expansion
    await kbFileStore.loadSearchableFiles(kb.id);
  }
  emit("updated");
}

function toggleExpand(kbId: string) {
  expandedKbId.value = expandedKbId.value === kbId ? null : kbId;
  kbFileStore.loadSearchableFiles(kbId);
}

function getSearchableFiles(kbId: string) {
  return kbFileStore.searchableFiles(kbId);
}
</script>

<template>
  <NPopover v-model:show="showPopover" placement="top-start" trigger="click" :width="300">
    <template #trigger>
      <button class="kb-picker-trigger" :class="{ active: selectedKbIds.size > 0 }">
        <svg width="13" height="13" viewBox="0 0 18 18" fill="none">
          <path d="M3 3h4a2 2 0 012 2v10a1.5 1.5 0 00-1.5-1.5H3V3z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
          <path d="M15 3h-4a2 2 0 00-2 2v10a1.5 1.5 0 011.5-1.5H15V3z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
        </svg>
        <span v-if="selectedKbIds.size" class="kb-badge">{{ selectedKbIds.size }}</span>
      </button>
    </template>

    <div class="kb-picker-body">
      <div class="kb-picker-header">
        <span class="kb-picker-title">{{ t('kb.chat.picker.title') }}</span>
        <span class="kb-picker-hint">{{ t('kb.chat.picker.max', { max: 10 }) }}</span>
      </div>

      <div v-if="!enabledKbs.length" class="kb-picker-empty">
        {{ t('kb.chat.picker.empty') }}
      </div>

      <div v-else class="kb-picker-list">
        <div v-for="kb in enabledKbs" :key="kb.id" class="kb-picker-item">
          <div class="kb-item-row">
            <NCheckbox
              :checked="selectedKbIds.has(kb.id)"
              @update:checked="toggleKb(kb)"
              :disabled="!selectedKbIds.has(kb.id) && selectedKbIds.size >= 10"
            />
            <button class="kb-item-name" @click="toggleExpand(kb.id)">
              <span class="kb-name-text">{{ kb.name }}</span>
              <span class="kb-file-count">{{ t('kb.chat.picker.fileCount', { n: kb.searchableFileCount }) }}</span>
              <svg
                class="kb-expand-icon"
                :class="{ open: expandedKbId === kb.id }"
                width="10" height="10" viewBox="0 0 10 10" fill="none"
              >
                <path d="M3 4l2 2 2-2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>

          <!-- Expanded file list -->
          <div v-if="expandedKbId === kb.id" class="kb-item-files">
            <div v-for="file in getSearchableFiles(kb.id)" :key="file.id" class="kb-file-row">
              <span class="kb-file-name">{{ file.name }}</span>
              <span class="kb-file-ext">.{{ file.ext }}</span>
            </div>
            <div v-if="!getSearchableFiles(kb.id).length" class="kb-no-files">
              {{ t('kb.chat.picker.noFiles') }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </NPopover>
</template>

<style scoped>
.kb-picker-trigger {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
  position: relative;
  flex-shrink: 0;
}
.kb-picker-trigger:hover {
  border-color: var(--accent);
  color: var(--text-primary);
  background: var(--bg-hover);
}
.kb-badge {
  position: absolute;
  top: -3px;
  right: -3px;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  border-radius: 7px;
  background: var(--accent);
  color: var(--bg-void);
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}

.kb-picker-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.kb-picker-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.kb-picker-title {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}
.kb-picker-hint {
  font-size: 10px;
  color: var(--text-muted);
}
.kb-picker-empty {
  padding: 16px 0;
  text-align: center;
  font-size: 12px;
  color: var(--text-muted);
}

.kb-picker-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 320px;
  overflow-y: auto;
}
.kb-picker-item {
  border-radius: var(--radius-sm);
}
.kb-item-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
}
.kb-item-name {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: transparent;
  padding: 2px 4px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--transition-fast);
  min-width: 0;
}
.kb-item-name:hover {
  background: var(--bg-hover);
}
.kb-name-text {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  text-align: left;
}
.kb-file-count {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-muted);
  flex-shrink: 0;
}
.kb-expand-icon {
  color: var(--text-muted);
  flex-shrink: 0;
  transition: transform var(--transition-fast);
}
.kb-expand-icon.open {
  transform: rotate(180deg);
}

.kb-item-files {
  padding: 4px 0 4px 28px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.kb-file-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 6px;
  border-radius: var(--radius-sm);
  font-size: 11px;
}
.kb-file-name {
  font-family: var(--font-mono);
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.kb-file-ext {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-muted);
  flex-shrink: 0;
}
.kb-no-files {
  font-size: 11px;
  color: var(--text-muted);
  padding: 4px 6px;
}
</style>
