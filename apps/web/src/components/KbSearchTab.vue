<script setup lang="ts">
import { ref, computed } from "vue";
import { NInput, NButton, NSelect, NSpin, NEmpty } from "naive-ui";
import { api } from "../api/client.js";
import { useI18n } from "../i18n/index.js";
import type { KbSearchHitDto } from "@pi-web-ui/shared";

const props = defineProps<{ kbId: string }>();
const { t } = useI18n();

const query = ref("");
const limit = ref(5);
const hits = ref<KbSearchHitDto[]>([]);
const durationMs = ref(0);
const loading = ref(false);
const searched = ref(false);

const limitOptions = [
  { label: "5", value: 5 },
  { label: "8", value: 8 },
  { label: "10", value: 10 },
  { label: "20", value: 20 },
];

const canSearch = computed(() => query.value.trim().length > 0 && !loading.value);

async function handleSearch() {
  if (!canSearch.value) return;
  loading.value = true;
  searched.value = true;
  hits.value = [];
  durationMs.value = 0;

  try {
    const result = await api.searchKb(query.value.trim(), [props.kbId], undefined, limit.value);
    hits.value = result.hits;
    durationMs.value = result.durationMs;
  } catch (e: any) {
    console.error("KB search failed:", e);
    hits.value = [];
  } finally {
    loading.value = false;
  }
}

function highlightSnippet(snippet: string): string {
  // Wrap <b> tags from FTS5 snippet in a highlight class
  return snippet.replace(/<b>(.*?)<\/b>/g, '<mark class="search-hl">$1</mark>');
}
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
      <div v-else-if="searched && !hits.length" class="search-state">
        <NEmpty :description="t('kb.search.noResults')" />
      </div>
      <div v-else-if="!searched" class="search-state hint">
        <p class="search-hint">{{ t('kb.search.placeholder') }}</p>
      </div>
      <template v-else>
        <div class="search-summary">
          {{ t('kb.search.returnCount') }}: {{ hits.length }} · {{ durationMs }}ms
        </div>
        <div class="search-results">
          <div v-for="(hit, i) in hits" :key="i" class="search-result">
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
            <div class="result-score">
              score: {{ hit.score.toFixed(2) }}
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
.result-snippet :deep(.search-hl) {
  background: var(--amber-dim, rgba(229, 168, 18, 0.2));
  color: var(--text-primary);
  border-radius: 2px;
  padding: 0 2px;
  font-weight: 600;
}

.result-score {
  margin-top: 6px;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-faint);
}
</style>
