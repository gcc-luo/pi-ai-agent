<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "../i18n/index.js";
import { formatTokenCount } from "../utils/format-token-count.js";
import type { TokenUsageSummary } from "../utils/token-usage.js";
import TokenCounts from "./TokenCounts.vue";

const props = defineProps<{ usage: TokenUsageSummary; busy: boolean }>();
const emit = defineEmits<{ (e: "compact"): void }>();
const { t } = useI18n();
const count = (value: number | null) => value === null ? "—" : formatTokenCount(value);
const rows = computed(() => [
  { label: t("chat.usageCurrent"), value: props.usage.current },
  { label: t("chat.usageSession"), value: props.usage.session },
]);
</script>

<template>
  <details class="token-usage" @keydown.esc="($event.currentTarget as HTMLDetailsElement).open = false">
    <summary class="token-usage-summary" :title="t('chat.usageDetails')">
      <span>{{ t('chat.usageSession') }}</span>
      <TokenCounts :input="usage.session.prompt" :output="usage.session.output" />
    </summary>
    <section class="token-usage-details" :aria-label="t('chat.usageDetails')">
      <strong>{{ t('chat.usageDetails') }}</strong>
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
  </details>
</template>

<style scoped>
.token-usage { margin-left: auto; font-size: 11px; color: var(--text-muted); }
.token-usage-summary { display: flex; align-items: center; gap: 6px; cursor: pointer; white-space: nowrap; font-variant-numeric: tabular-nums; }
.token-usage-summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; }
.token-usage-details { position: absolute; right: 0; bottom: calc(100% + 10px); width: min(580px, 100%); max-height: 60vh; overflow: auto; padding: 16px; border: 1px solid var(--border-default); border-radius: 10px; background: var(--bg-surface); color: var(--text-primary); box-shadow: 0 8px 28px #0004; z-index: 30; }
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
