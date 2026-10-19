<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "../../i18n/index.js";
import FilePreviewError from "./FilePreviewError.vue";

// Browsers render PDFs natively inside an <iframe>. Chromium/Firefox/Safari
// all ship a built-in viewer with pagination, search, and zoom — we just
// point it at the raw stream.
const props = defineProps<{ url: string; reloadKey?: number }>();
const { t } = useI18n();
const loading = ref(true);
const ready = ref(false);
const error = ref("");
const retryVersion = ref(0);
let requestVersion = 0;

function retry() {
  retryVersion.value++;
}

async function load() {
  const currentRequest = ++requestVersion;
  loading.value = true;
  ready.value = false;
  error.value = "";
  try {
    // A native PDF viewer does not reliably expose HTTP failures through the
    // iframe error event, so check the raw endpoint before embedding it.
    const response = await fetch(props.url, {
      headers: { Range: "bytes=0-0" },
    });
    if (!response.ok) {
      let message = `${t("viewer.loadFailed")} (${response.status})`;
      try {
        const body = await response.json() as { error?: unknown };
        if (typeof body.error === "string" && body.error) message = body.error;
      } catch {
        // Keep the status-based message if the server did not return JSON.
      }
      throw new Error(message);
    }
    try {
      await response.body?.cancel();
    } catch {
      // The browser may already have closed the short range response.
    }
    if (currentRequest === requestVersion) ready.value = true;
  } catch (loadError) {
    if (currentRequest === requestVersion) {
      error.value = loadError instanceof Error ? loadError.message : String(loadError);
    }
  } finally {
    if (currentRequest === requestVersion) loading.value = false;
  }
}

watch(() => [props.url, props.reloadKey, retryVersion.value], () => void load(), { immediate: true });
onBeforeUnmount(() => { requestVersion++; });
</script>

<template>
  <div class="pdf-preview">
    <div v-if="loading" class="pdf-state">{{ t('viewer.rendering') }}</div>
    <FilePreviewError v-else-if="error" :message="error" retry-test-id="retry-pdf-preview" @retry="retry" />
    <!-- The preflight handles raw endpoint errors; iframe failures are not assumed to be observable. -->
    <iframe v-else-if="ready" :key="retryVersion" :src="url" class="pdf-frame" title="PDF preview" />
  </div>
</template>

<style scoped>
.pdf-preview {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: var(--bg-void);
}
.pdf-state {
  display: grid;
  flex: 1;
  place-items: center;
  color: var(--text-muted);
  font-size: 12px;
}
.pdf-frame {
  flex: 1;
  border: none;
  background: var(--bg-void);
  width: 100%;
  min-height: 0;
}
</style>
