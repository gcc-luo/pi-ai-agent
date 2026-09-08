<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from "vue";
import { useI18n } from "../i18n/index.js";
import { formatTokenCount } from "../utils/format-token-count.js";
import type { TokenUsageSummary } from "../utils/token-usage.js";
import TokenCounts from "./TokenCounts.vue";

const props = defineProps<{ usage: TokenUsageSummary; busy: boolean }>();
const emit = defineEmits<{ (e: "compact"): void }>();
const { t } = useI18n();
const showDetails = ref(false);
const summaryButton = ref<HTMLButtonElement | null>(null);
const closeButton = ref<HTMLButtonElement | null>(null);
const count = (value: number | null) => value === null ? "—" : formatTokenCount(value);
const rows = computed(() => [
  { label: t("chat.usageCurrent"), value: props.usage.current },
  { label: t("chat.usageSession"), value: props.usage.session },
]);

function closeDetails() {
  showDetails.value = false;
  document.removeEventListener("keydown", handleKeydown);
  void nextTick(() => summaryButton.value?.focus());
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") closeDetails();
}

function openDetails() {
  showDetails.value = true;
  document.addEventListener("keydown", handleKeydown);
  void nextTick(() => closeButton.value?.focus());
}

onBeforeUnmount(() => document.removeEventListener("keydown", handleKeydown));
</script>

<template>
  <div class="token-usage">
    <button
      type="button"
      class="token-usage-summary"
      ref="summaryButton"
      :title="t('chat.usageDetails')"
      :aria-expanded="showDetails"
      @click="openDetails"
    >
      <span>{{ t('chat.usageSession') }}</span>
      <TokenCounts :input="usage.session.prompt" :output="usage.session.output" />
    </button>
    <Teleport to="body">
      <div v-if="showDetails" class="token-usage-backdrop" @click.self="closeDetails">
        <section class="token-usage-details" role="dialog" aria-modal="true" :aria-label="t('chat.usageDetails')">
          <header class="token-usage-header">
            <strong>{{ t('chat.usageDetails') }}</strong>
            <button ref="closeButton" type="button" class="token-usage-close" :aria-label="t('common.close')" @click="closeDetails">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
              </svg>
            </button>
          </header>
          <p>{{ t('chat.usageHint') }}</p>
          <div class="usage-table-scroll">
            <table>
              <thead><tr>
                <th></th><th>{{ t('chat.usageInput') }}</th><th>{{ t('chat.usageOutput') }}</th>
                <th>{{ t('chat.usageCacheRead') }}</th><th>{{ t('chat.usageCacheWrite') }}</th>
                <th>{{ t('chat.usageModels') }}</th><th>{{ t('chat.usageTools') }}</th>
              </tr></thead>
              <tbody><tr v-for="row in rows" :key="row.label">
                <th>{{ row.label }}</th><td class="token-in">{{ count(row.value.prompt) }}</td><td class="token-out">{{ count(row.value.output) }}</td>
                <td>{{ count(row.value.cacheRead) }}</td><td>{{ count(row.value.cacheWrite) }}</td>
                <td>{{ row.value.modelCalls }}</td><td>{{ row.value.toolCalls }}</td>
              </tr></tbody>
            </table>
          </div>
          <p v-if="usage.latest">{{ t('chat.usageLatest') }}: <TokenCounts :input="usage.latest.prompt" :output="usage.latest.output" /> · {{ usage.latest.model }}</p>
          <details v-if="usage.calls.length" class="usage-call-list">
            <summary>{{ t('chat.usageCallDetails') }}</summary>
            <div class="usage-table-scroll">
              <table>
                <thead><tr><th>#</th><th>{{ t('chat.usageModel') }}</th><th>↑</th><th>↓</th><th>{{ t('chat.usageCacheRead') }}</th><th>{{ t('chat.usageCacheWrite') }}</th><th>{{ t('chat.usageTools') }}</th></tr></thead>
                <tbody><tr v-for="(call, index) in usage.calls" :key="call.id">
                  <td>{{ index + 1 }}</td><td>{{ call.model }}</td><td class="token-in">{{ count(call.prompt) }}</td><td class="token-out">{{ count(call.output) }}</td><td>{{ count(call.cacheRead) }}</td><td>{{ count(call.cacheWrite) }}</td><td>{{ call.toolCalls }}</td>
                </tr></tbody>
              </table>
            </div>
          </details>
          <button type="button" class="compact-context-btn" :disabled="busy || !usage.session.modelCalls" @click="emit('compact')">{{ t('chat.compactContext') }}</button>
          <p>{{ t('chat.compactContextHint') }}</p>
        </section>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.token-usage { font-size: 11px; color: var(--text-muted); }
.token-usage-summary { display: flex; align-items: center; gap: 6px; margin: 0; padding: 2px 0; border: 0; background: transparent; color: inherit; cursor: pointer; white-space: nowrap; font: inherit; font-variant-numeric: tabular-nums; }
.token-usage-summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; }
.token-usage-summary:hover { color: var(--text-primary); }
.token-usage-backdrop { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; padding: 20px; background: rgba(15, 23, 42, .36); z-index: 1000; }
.token-usage-details { position: relative; width: min(580px, calc(100vw - 40px)); max-height: min(72vh, 720px); overflow: auto; padding: 18px 20px; border: 1px solid var(--border-default); border-radius: 10px; background: var(--bg-surface); color: var(--text-primary); box-shadow: 0 16px 48px rgba(0, 0, 0, .2); }
.token-usage-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 4px; }
.token-usage-close { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; width: 28px; height: 28px; margin: -4px -6px 0 0; padding: 0; border: 0; border-radius: 5px; background: transparent; color: var(--text-muted); cursor: pointer; }
.token-usage-close:hover { background: var(--bg-hover); color: var(--text-primary); }
.token-usage-close:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.token-usage-details p { color: var(--text-muted); line-height: 1.6; margin: 8px 0; }
.usage-table-scroll { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
th, td { padding: 7px 6px; text-align: right; white-space: nowrap; border-bottom: 1px solid var(--border-default); }
th:first-child, td:first-child { text-align: left; }
.usage-call-list { margin: 12px 0; }
.usage-call-list summary { cursor: pointer; }
.compact-context-btn { padding: 6px 10px; border: 1px solid var(--border-default); border-radius: 5px; background: transparent; color: var(--accent); cursor: pointer; }
.compact-context-btn:disabled { opacity: .45; cursor: not-allowed; }
</style>
