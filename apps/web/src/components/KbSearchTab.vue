<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from "vue";
import { NInput, NButton, NSelect, NSpin, NEmpty } from "naive-ui";
import { api } from "../api/client.js";
import { useI18n } from "../i18n/index.js";
import type { KbSearchDiagnostics, KbSearchHitDto } from "@pi-web-ui/shared";
import DOMPurify from "dompurify";

const props = defineProps<{ kbId: string }>();
const { t } = useI18n();

const query = ref("");
const limit = ref(5);
const hits = ref<KbSearchHitDto[]>([]);
const diagnostics = ref<KbSearchDiagnostics | null>(null);
const durationMs = ref(0);
const loading = ref(false);
const searched = ref(false);
const error = ref("");
let requestId = 0;

watch(() => props.kbId, () => {
  requestId++;
  query.value = "";
  hits.value = [];
  diagnostics.value = null;
  durationMs.value = 0;
  loading.value = false;
  searched.value = false;
  error.value = "";
});
onUnmounted(() => { requestId++; });

const limitOptions = [
  { label: "5", value: 5 },
  { label: "8", value: 8 },
  { label: "10", value: 10 },
  { label: "20", value: 20 },
];

const canSearch = computed(() => query.value.trim().length > 0 && !loading.value);

async function handleSearch() {
  if (!canSearch.value) return;
  const request = ++requestId;
  error.value = "";
  loading.value = true;
  searched.value = true;
  hits.value = [];
  diagnostics.value = null;
  durationMs.value = 0;

  try {
    const result = await api.searchKb(query.value.trim(), [props.kbId], undefined, limit.value);
    if (request !== requestId) return;
    hits.value = result.hits;
    durationMs.value = result.durationMs;
    diagnostics.value = result.diagnostics;
  } catch (e: unknown) {
    if (request !== requestId) return;
    error.value = e instanceof Error ? e.message : t("kb.search.failed");
    hits.value = [];
  } finally {
    if (request === requestId) loading.value = false;
  }
}

function highlightSnippet(snippet: string): string {
  const normalized = snippet.replace(/<b>(.*?)<\/b>/g, '<mark class="search-hl">$1</mark>');
  return DOMPurify.sanitize(normalized, {
    ALLOWED_TAGS: ["mark"],
    ALLOWED_ATTR: ["class"],
  });
}

const diagnosticNotice = computed(() => {
  const value = diagnostics.value;
  if (!value) return "";
  if (value.searchableChunkCount === 0) return t("kb.chat.card.noSearchableContent");
  switch (value.semanticStatus) {
    case "not_configured": return t("kb.chat.card.keywordFallback");
    case "index_missing": return t("kb.chat.card.indexMissing", { indexed: value.indexedChunkCount, total: value.searchableChunkCount });
    case "partial": return t("kb.chat.card.partialIndex", { indexed: value.indexedChunkCount, total: value.searchableChunkCount });
    case "failed": return t("kb.chat.card.embeddingFailed");
    default: return "";
  }
});

const diagnosticMode = computed(() => diagnostics.value
  ? t(`kb.chat.card.mode.${diagnostics.value.mode}`)
  : "");
</script>

<template>
  <div class="kb-search-tab">
    <!-- Search bar -->
    <div class="search-toolbar">
      <NInput
        v-model:value="query"
        size="small"
        :placeholder="t('kb.search.placeholder')"
        clearable
        class="search-input"
        @keydown.enter="handleSearch"
      />
      <NSelect
        v-model:value="limit"
        :options="limitOptions"
        size="small"
        class="search-limit"
      />
      <NButton size="small" type="primary" :disabled="!canSearch" @click="handleSearch">
        {{ t('skillStore.search') }}
      </NButton>
    </div>

    <!-- Results -->
    <div class="search-body">
      <div v-if="loading" class="search-state">
        <NSpin size="medium" />
      </div>
      <div v-else-if="error" class="search-state search-error" role="alert">
        <p>{{ t('kb.search.failed') }}</p>
        <p class="search-error-detail">{{ error }}</p>
        <NButton size="small" :disabled="!canSearch" @click="handleSearch">{{ t('kb.search.retry') }}</NButton>
      </div>
      <div v-else-if="searched && !hits.length" class="search-state">
        <div class="search-empty">
          <NEmpty :description="diagnostics?.searchableChunkCount === 0 ? t('kb.chat.card.noSearchableContent') : t('kb.search.noResults')" />
          <p v-if="diagnosticMode" class="search-diagnostic">{{ diagnosticMode }}</p>
          <p v-if="diagnosticNotice && diagnostics?.searchableChunkCount !== 0" class="search-diagnostic warning">{{ diagnosticNotice }}</p>
        </div>
      </div>
      <div v-else-if="!searched" class="search-state hint">
        <p class="search-hint">{{ t('kb.search.placeholder') }}</p>
      </div>
      <template v-else>
        <div class="search-summary">
          {{ t('kb.search.returnCount') }}: {{ hits.length }} · {{ durationMs }}ms
        </div>
        <div v-if="diagnosticMode || diagnosticNotice" class="search-diagnostic">
          <span v-if="diagnosticMode">{{ diagnosticMode }}</span>
          <span v-if="diagnosticNotice" class="warning">{{ diagnosticNotice }}</span>
        </div>
        <div class="search-results">
          <div v-for="hit in hits" :key="hit.chunkId" class="search-result">
            <div class="result-header">
              <span class="result-kb">{{ hit.kbName }}</span>
              <span class="result-sep">/</span>
              <span class="result-file">{{ hit.fileName }}</span>
              <span v-if="hit.titlePath" class="result-title">{{ hit.titlePath }}</span>
              <span v-if="hit.pageStart != null" class="result-pages">
                p.{{ hit.pageStart }}{{ hit.pageEnd != null && hit.pageEnd !== hit.pageStart ? `–${hit.pageEnd}` : "" }}
              </span>
            </div>
            <div class="result-snippet" v-html="highlightSnippet(hit.snippet)" />
            <div class="result-match-tags">
              <span v-if="hit.keywordScore !== undefined" class="match-tag">{{ t('kb.search.keywordMatch') }}</span>
              <span v-if="hit.vectorScore !== undefined" class="match-tag semantic">{{ t('kb.search.semanticMatch') }}</span>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.kb-search-tab {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  height: 100%;
}

.search-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 28px 12px;
  flex-shrink: 0;
}
.search-input {
  flex: 1;
}
.search-limit {
  width: 80px;
}

.search-body {
  flex: 1;
  overflow-y: auto;
  padding: 0 28px 24px;
}
.search-state {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 60px 0;
}
.search-error {
  flex-direction: column;
  gap: 8px;
  color: var(--rose);
}
.search-error p { margin: 0; }
.search-error-detail {
  color: var(--text-muted);
  overflow-wrap: anywhere;
}
.search-state.hint {
  padding: 40px 0;
}
.search-hint {
  margin: 0;
  font-size: 13px;
  color: var(--text-muted);
}

.search-summary {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-subtle);
}
.search-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
}
.search-diagnostic {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: -4px 0 12px;
  font-size: 11px;
  color: var(--text-muted);
}
.search-diagnostic.warning {
  color: var(--amber, #d99213);
}

.search-results {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.search-result {
  padding: 12px 14px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  transition: border-color var(--transition-fast);
}
.search-result:hover {
  border-color: var(--accent);
}

.result-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  flex-wrap: wrap;
  font-family: var(--font-mono);
  font-size: 11px;
}
.result-kb {
  color: var(--accent);
  font-weight: 600;
}
.result-sep {
  color: var(--text-faint);
}
.result-file {
  color: var(--text-primary);
  font-weight: 500;
}
.result-title {
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 200px;
}
.result-pages {
  margin-left: auto;
  color: var(--text-muted);
  flex-shrink: 0;
}

.result-snippet {
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-secondary);
  word-break: break-word;
}
.result-snippet :deep(mark) {
  background: var(--amber-dim, rgba(229, 168, 18, 0.2));
  color: var(--text-primary);
  border-radius: 2px;
  padding: 0 2px;
  font-weight: 600;
}

.result-match-tags {
  display: flex;
  gap: 5px;
  margin-top: 6px;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-faint);
}
.match-tag {
  padding: 1px 5px;
  border: 1px solid var(--border-subtle);
  border-radius: 999px;
}
.match-tag.semantic {
  color: var(--accent);
  border-color: var(--accent-dim);
}
</style>
