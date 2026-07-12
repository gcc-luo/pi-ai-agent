<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "../../i18n/index.js";

// Fallback for files we cannot preview (executables, archives, .pptx, legacy
// Office binaries, etc.). Offers a download link to the raw stream so the
// user still gets a one-click action instead of an opaque dead end.
const props = defineProps<{ path: string; url: string; reason?: string }>();
const { t } = useI18n();

const fileName = computed(() => {
  const parts = props.path.split("/");
  return parts[parts.length - 1] || props.path;
});
</script>

<template>
  <div class="unsupported">
    <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
      <path
        d="M8 4a2 2 0 012-2h12l8 8v22a2 2 0 01-2 2H10a2 2 0 01-2-2V4z"
        stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"
      />
      <path d="M22 2v8h8" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" />
      <path d="M14 22h12M14 26h8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
    </svg>
    <p class="title">{{ fileName }}</p>
    <p class="hint">{{ reason ?? t('viewer.unsupportedHint') }}</p>
    <a class="download" :href="url" :download="fileName">{{ t('viewer.download') }}</a>
  </div>
</template>

<style scoped>
.unsupported {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-muted);
  background: var(--bg-void);
  padding: 24px;
  text-align: center;
}
.title {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--text-primary);
  margin: 4px 0 0;
  word-break: break-all;
}
.hint {
  font-size: 12px;
  color: var(--text-faint);
  margin: 0;
  max-width: 360px;
  line-height: 1.5;
}
.download {
  margin-top: 10px;
  padding: 7px 18px;
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: var(--bg-void);
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
  text-decoration: none;
  transition: filter var(--transition-fast);
}
.download:hover { filter: brightness(1.1); }
</style>
