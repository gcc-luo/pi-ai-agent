<script setup lang="ts">
import { useI18n } from "../i18n/index.js";
import { formatTokenCount } from "../utils/format-token-count.js";

defineProps<{ input: number; output: number }>();
const { t } = useI18n();
</script>

<template>
  <span class="token-counts">
    <span class="token-in" :title="`${t('chat.usageInput')}: ${input}`" :aria-label="`${t('chat.usageInput')}: ${input}`"><span class="token-arrow token-arrow-in" aria-hidden="true">↑</span><span class="token-value">{{ formatTokenCount(input) }}</span></span>
    <span class="token-out" :title="`${t('chat.usageOutput')}: ${output}`" :aria-label="`${t('chat.usageOutput')}: ${output}`"><span class="token-arrow token-arrow-out" aria-hidden="true">↓</span><span class="token-value">{{ formatTokenCount(output) }}</span></span>
  </span>
</template>

<style scoped>
.token-counts { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; font-variant-numeric: tabular-nums; }
</style>
