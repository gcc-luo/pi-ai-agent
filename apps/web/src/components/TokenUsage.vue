<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref } from "vue";
import { useI18n } from "../i18n/index.js";
import { formatTokenCount } from "../utils/format-token-count.js";
import type { TokenUsageSummary } from "../utils/token-usage.js";
import TokenCounts from "./TokenCounts.vue";

defineProps<{ usage: TokenUsageSummary; busy: boolean }>();
const emit = defineEmits<{ (e: "compact"): void }>();
const { t } = useI18n();
type UsageTab = "overview" | "calls";
const showDetails = ref(false);
const activeTab = ref<UsageTab>("overview");
const summaryButton = ref<HTMLButtonElement | null>(null);
const closeButton = ref<HTMLButtonElement | null>(null);
const count = (value: number | null) => value === null ? "—" : formatTokenCount(value);

function closeDetails() {
  showDetails.value = false;
  document.removeEventListener("keydown", handleKeydown);
  void nextTick(() => summaryButton.value?.focus());
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") closeDetails();
}

function openDetails() {
  activeTab.value = "overview";
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
          <div class="token-usage-tabs" role="tablist" :aria-label="t('chat.usageDetails')">
            <button
              id="usage-overview-tab"
              type="button"
              class="token-usage-tab"
              role="tab"
              data-tab="overview"
              aria-controls="usage-overview-panel"
              :aria-selected="activeTab === 'overview'"
              @click="activeTab = 'overview'"
            >
              {{ t('chat.usageOverview') }}
            </button>
            <button
              id="usage-calls-tab"
              type="button"
              class="token-usage-tab"
              role="tab"
              data-tab="calls"
              aria-controls="usage-calls-panel"
              :aria-selected="activeTab === 'calls'"
              @click="activeTab = 'calls'"
            >
              {{ t('chat.usageCallDetailsTab') }}
              <span class="token-usage-tab-count">{{ usage.calls.length }}</span>
            </button>
          </div>
          <section
            v-if="activeTab === 'overview'"
            id="usage-overview-panel"
            class="token-usage-panel"
            data-panel="overview"
            role="tabpanel"
            aria-labelledby="usage-overview-tab"
            tabindex="0"
          >
            <div class="usage-metric-grid">
              <article class="usage-metric-card">
                <span>{{ t('chat.usageCurrent') }} · {{ t('chat.usageInput') }}</span>
                <strong class="token-in">{{ count(usage.current.prompt) }}</strong>
              </article>
              <article class="usage-metric-card">
                <span>{{ t('chat.usageCurrent') }} · {{ t('chat.usageOutput') }}</span>
                <strong class="token-out">{{ count(usage.current.output) }}</strong>
              </article>
              <article class="usage-metric-card">
                <span>{{ t('chat.usageSession') }} · {{ t('chat.usageInput') }}</span>
                <strong class="token-in">{{ count(usage.session.prompt) }}</strong>
              </article>
              <article class="usage-metric-card">
                <span>{{ t('chat.usageSession') }} · {{ t('chat.usageOutput') }}</span>
                <strong class="token-out">{{ count(usage.session.output) }}</strong>
              </article>
            </div>
            <div class="usage-facts">
              <div>
                <span>{{ t('chat.usageCacheRead') }}<small>（{{ t('chat.usageCurrent') }} / {{ t('chat.usageSession') }}）</small></span>
                <b>{{ count(usage.current.cacheRead) }} / {{ count(usage.session.cacheRead) }}</b>
              </div>
              <div>
                <span>{{ t('chat.usageCacheWrite') }}<small>（{{ t('chat.usageCurrent') }} / {{ t('chat.usageSession') }}）</small></span>
                <b>{{ count(usage.current.cacheWrite) }} / {{ count(usage.session.cacheWrite) }}</b>
              </div>
              <div>
                <span>{{ t('chat.usageModels') }}<small>（{{ t('chat.usageCurrent') }} / {{ t('chat.usageSession') }}）</small></span>
                <b>{{ usage.current.modelCalls }} / {{ usage.session.modelCalls }}</b>
              </div>
              <div>
                <span>{{ t('chat.usageTools') }}<small>（{{ t('chat.usageCurrent') }} / {{ t('chat.usageSession') }}）</small></span>
                <b>{{ usage.current.toolCalls }} / {{ usage.session.toolCalls }}</b>
              </div>
            </div>
            <p v-if="usage.latest">{{ t('chat.usageLatest') }}: <TokenCounts :input="usage.latest.prompt" :output="usage.latest.output" /> · {{ usage.latest.model }}</p>
            <button type="button" class="compact-context-btn" :disabled="busy || !usage.session.modelCalls" @click="emit('compact')">{{ t('chat.compactContext') }}</button>
            <p>{{ t('chat.compactContextHint') }}</p>
          </section>
          <section
            v-else
            id="usage-calls-panel"
            class="token-usage-panel"
            data-panel="calls"
            role="tabpanel"
            aria-labelledby="usage-calls-tab"
            tabindex="0"
          >
            <div v-if="usage.calls.length" class="usage-table-scroll">
              <table>
                <thead><tr><th>#</th><th>{{ t('chat.usageModel') }}</th><th>↑</th><th>↓</th><th>{{ t('chat.usageCacheRead') }}</th><th>{{ t('chat.usageCacheWrite') }}</th><th>{{ t('chat.usageTools') }}</th></tr></thead>
                <tbody><tr v-for="(call, index) in usage.calls" :key="call.id">
                  <td>{{ index + 1 }}</td><td>{{ call.model }}</td><td class="token-in">{{ count(call.prompt) }}</td><td class="token-out">{{ count(call.output) }}</td><td>{{ count(call.cacheRead) }}</td><td>{{ count(call.cacheWrite) }}</td><td>{{ call.toolCalls }}</td>
                </tr></tbody>
              </table>
            </div>
            <p v-else class="usage-empty-state">{{ t('chat.usageNoCalls') }}</p>
          </section>
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
.token-usage-tabs { display: flex; gap: 22px; margin: 0 -20px 16px; padding: 0 20px; border-bottom: 1px solid var(--border-default); }
.token-usage-tab { position: relative; padding: 9px 1px; border: 0; background: transparent; color: var(--text-muted); cursor: pointer; font: inherit; }
.token-usage-tab[aria-selected="true"] { color: var(--accent); }
.token-usage-tab[aria-selected="true"]::after { position: absolute; right: 0; bottom: -1px; left: 0; height: 2px; border-radius: 2px 2px 0 0; background: var(--accent); content: ""; }
.token-usage-tab:hover { color: var(--text-primary); }
.token-usage-tab:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.token-usage-tab-count { display: inline-flex; align-items: center; justify-content: center; min-width: 16px; height: 16px; margin-left: 4px; padding: 0 4px; border-radius: 8px; background: var(--bg-elevated); color: var(--text-muted); font-size: 10px; font-variant-numeric: tabular-nums; }
.token-usage-tab[aria-selected="true"] .token-usage-tab-count { background: var(--accent-dim); color: var(--accent); }
.token-usage-panel:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; border-radius: 5px; }
.usage-metric-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.usage-metric-card { display: flex; flex-direction: column; gap: 8px; padding: 12px; border: 1px solid var(--border-subtle); border-radius: 8px; background: var(--bg-elevated); }
.usage-metric-card span, .usage-facts span { color: var(--text-muted); font-size: 10px; }
.usage-metric-card strong { font-size: 18px; font-variant-numeric: tabular-nums; }
.usage-facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 12px; }
.usage-facts > div { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 10px; border-radius: 6px; background: var(--bg-elevated); }
.usage-facts span { min-width: 0; }
.usage-facts small { display: block; margin-top: 3px; color: var(--text-faint); font-size: 9px; }
.usage-facts b { color: var(--text-secondary); font-size: 11px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.usage-table-scroll { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
th, td { padding: 7px 6px; text-align: right; white-space: nowrap; border-bottom: 1px solid var(--border-default); }
th:first-child, td:first-child { text-align: left; }
.usage-empty-state { padding: 28px 8px; text-align: center; color: var(--text-muted); }
.compact-context-btn { padding: 6px 10px; border: 1px solid var(--border-default); border-radius: 5px; background: transparent; color: var(--accent); cursor: pointer; }
.compact-context-btn:disabled { opacity: .45; cursor: not-allowed; }
@media (max-width: 520px) {
  .usage-metric-grid, .usage-facts { grid-template-columns: 1fr; }
}
</style>
