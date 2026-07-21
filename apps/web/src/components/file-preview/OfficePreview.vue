<script setup lang="ts">
import { ref, watch, computed, onMounted } from "vue";
import { api } from "../../api/client.js";
import { useI18n } from "../../i18n/index.js";

const props = defineProps<{ projectId: string; path: string }>();
const { t } = useI18n();

// null = not yet checked, true = available, false = unavailable
const loAvailable = ref<boolean | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);

const pdfUrl = computed(() => api.officePdfUrl(props.projectId, props.path));

onMounted(async () => {
  try {
    const status = await api.checkOfficeAvailability();
    loAvailable.value = status.available;
  } catch {
    loAvailable.value = false;
  }
});

watch(
  () => [props.projectId, props.path],
  () => {
    loading.value = true;
    error.value = null;
  },
);

function onIframeLoad() {
  loading.value = false;
}
function onIframeError() {
  loading.value = false;
  error.value = t("viewer.officeConvertFailed");
}
</script>

<template>
  <div class="office-preview">
    <!-- LibreOffice not installed -->
    <div v-if="loAvailable === false" class="state unavailable">
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
        <circle cx="24" cy="24" r="20" stroke="currentColor" stroke-width="1.5" />
        <path
          d="M24 14v12M24 30v2"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        />
      </svg>
      <p class="unavailable-title">{{ t("viewer.officeUnavailable") }}</p>
      <p class="unavailable-hint">{{ t("viewer.officeUnavailableHint") }}</p>
      <a
        class="download-link"
        href="https://www.libreoffice.org/download/"
        target="_blank"
        rel="noopener"
      >
        {{ t("viewer.officeDownloadLink") }}
      </a>
    </div>

    <!-- Converting -->
    <div v-else-if="loading" class="state">
      <div class="spinner" />
      <span>{{ t("viewer.officeConverting") }}</span>
    </div>

    <!-- Conversion error -->
    <div v-else-if="error" class="state error">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="1.5" />
        <path
          d="M10 6v5M10 13.5v.5"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
        />
      </svg>
      <span>{{ error }}</span>
    </div>

    <!-- PDF iframe -->
    <iframe
      v-else
      :src="pdfUrl"
      class="office-frame"
      title="Office preview"
      @load="onIframeLoad"
      @error="onIframeError"
    />
  </div>
</template>

<style scoped>
.office-preview {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-void);
}

.office-frame {
  flex: 1;
  border: none;
  background: var(--bg-void);
  width: 100%;
  min-height: 0;
}

.state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-muted);
  font-size: 12px;
}

.state.error {
  color: var(--rose);
  flex-direction: column;
  gap: 6px;
}

.state.unavailable {
  flex-direction: column;
  gap: 10px;
  text-align: center;
  padding: 32px;
}

.unavailable-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.unavailable-hint {
  font-size: 12px;
  color: var(--text-faint);
  margin: 0;
  max-width: 400px;
  line-height: 1.6;
}

.download-link {
  margin-top: 6px;
  padding: 8px 20px;
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: var(--bg-void);
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
  text-decoration: none;
  transition: filter var(--transition-fast);
}

.download-link:hover {
  filter: brightness(1.1);
}

.spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--border-default);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
