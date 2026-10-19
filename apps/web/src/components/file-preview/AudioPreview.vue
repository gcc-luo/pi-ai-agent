<script setup lang="ts">
import { ref, watch } from "vue";
import { useI18n } from "../../i18n/index.js";
import FilePreviewError from "./FilePreviewError.vue";

const props = defineProps<{ url: string }>();
const failed = ref(false);
const reloadKey = ref(0);
const { t } = useI18n();

function retry() {
  failed.value = false;
  reloadKey.value++;
}

watch(() => props.url, retry);
</script>

<template>
  <div class="audio-preview">
    <FilePreviewError
      v-if="failed"
      :message="t('viewer.loadFailed')"
      retry-test-id="retry-media-preview"
      @retry="retry"
    />
    <template v-else>
      <svg class="icon" width="48" height="48" viewBox="0 0 48 48" fill="none">
        <circle cx="24" cy="24" r="22" stroke="currentColor" stroke-width="1.5" opacity="0.3" />
        <path d="M18 28V18a4 4 0 014-4h4a4 4 0 014 4v10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
        <rect x="14" y="26" width="8" height="14" rx="2" stroke="currentColor" stroke-width="1.6" />
        <rect x="26" y="26" width="8" height="14" rx="2" stroke="currentColor" stroke-width="1.6" />
      </svg>
      <audio :key="reloadKey" :src="url" controls preload="metadata" class="audio" @error="failed = true" />
    </template>
  </div>
</template>

<style scoped>
.audio-preview {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 18px;
  padding: 24px;
  background: var(--bg-void);
  color: var(--text-muted);
}
.audio {
  width: min(420px, 100%);
}
</style>
