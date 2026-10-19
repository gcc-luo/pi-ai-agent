<script setup lang="ts">
import { ref, watch } from "vue";
import { useI18n } from "../../i18n/index.js";
import FilePreviewError from "./FilePreviewError.vue";

// Native <img> preview. The URL points at the server's /raw endpoint which
// sets the correct Content-Type per extension; browsers handle the rest.
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
  <div class="image-preview">
    <FilePreviewError
      v-if="failed"
      :message="t('viewer.loadFailed')"
      retry-test-id="retry-media-preview"
      @retry="retry"
    />
    <img v-else :key="reloadKey" :src="url" alt="" class="image" @error="failed = true" />
  </div>
</template>

<style scoped>
.image-preview {
  flex: 1;
  overflow: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: var(--bg-void);
}
.image {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: var(--radius-sm);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
}
</style>
