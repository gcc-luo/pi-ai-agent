<script setup lang="ts">
import { ref, watch } from "vue";
import { api } from "../../api/client.js";
import { useI18n } from "../../i18n/index.js";

// .docx → HTML via mammoth. mammoth is dynamically imported on first use so
// the ~270KB library never lands in the main bundle for users who never
// open a .docx. Vite resolves its `browser` field automatically.

const props = defineProps<{ projectId: string; path: string }>();

const html = ref<string>("");
const loading = ref(false);
const error = ref<string | null>(null);
const { t } = useI18n();

async function load() {
  loading.value = true;
  error.value = null;
  html.value = "";
  try {
    const res = await fetch(api.rawFileUrl(props.projectId, props.path));
    if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
    const buf = await res.arrayBuffer();
    const mammoth = await import("mammoth");
    const result = await mammoth.default.convertToHtml({ arrayBuffer: buf });
    html.value = result.value;
  } catch (e: any) {
    error.value = e?.message ?? String(e);
  } finally {
    loading.value = false;
  }
}

watch(() => [props.projectId, props.path], load, { immediate: true });
</script>

<template>
  <div class="docx-preview">
    <div v-if="loading" class="state">{{ t('viewer.rendering') }}</div>
    <div v-else-if="error" class="state error">{{ error }}</div>
    <div v-else class="docx-html" v-html="html" />
  </div>
</template>

<style scoped>
.docx-preview {
  flex: 1;
  overflow-y: auto;
  background: var(--bg-void);
}
.docx-html {
  max-width: 820px;
  margin: 0 auto;
  padding: 32px 40px;
  background: var(--bg-surface);
  color: var(--text-primary);
  font-size: 14px;
  line-height: 1.65;
  min-height: 100%;
  box-shadow: 0 0 24px rgba(0, 0, 0, 0.15);
}
.docx-html :deep(p) { margin: 0 0 0.6em; }
.docx-html :deep(h1),
.docx-html :deep(h2),
.docx-html :deep(h3) { font-weight: 600; margin: 1em 0 0.4em; }
.docx-html :deep(h1) { font-size: 1.4em; }
.docx-html :deep(h2) { font-size: 1.2em; }
.docx-html :deep(h3) { font-size: 1.05em; }
.docx-html :deep(table) { border-collapse: collapse; width: 100%; margin: 0.5em 0; font-size: 13px; }
.docx-html :deep(td),
.docx-html :deep(th) { border: 1px solid var(--border-default); padding: 5px 8px; }
.docx-html :deep(ul),
.docx-html :deep(ol) { margin: 0.3em 0 0.7em; padding-left: 1.6em; }
.docx-html :deep(img) { max-width: 100%; }

.state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: 12px;
}
.state.error { color: var(--rose); }
</style>
