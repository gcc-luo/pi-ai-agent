<script setup lang="ts">
import { ref, watch } from "vue";
import { useI18n } from "../../i18n/index.js";
import FilePreviewError from "./FilePreviewError.vue";

// Native <video> with controls; the /raw endpoint honours Range requests so
// seeking works without buffering the whole file.
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
  <div class="video-preview">
    <FilePreviewError
      v-if="failed"
      :message="t('viewer.loadFailed')"
      retry-test-id="retry-media-preview"
      @retry="retry"
    />
    <video v-else :key="reloadKey" :src="url" controls preload="metadata" class="video" @error="failed = true" />
  </div>
</template>

<style scoped>
.video-preview {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: var(--bg-void);
}
.video {
  max-width: 100%;
  max-height: 100%;
  border-radius: var(--radius-sm);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}
</style>
