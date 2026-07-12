<script setup lang="ts">
import { ref, watch, computed } from "vue";
import { NSpin } from "naive-ui";
import { api } from "../api/client.js";
import { useI18n } from "../i18n/index.js";
import { filePreviewKind } from "../utils/file-kind.js";
import TextPreview from "./file-preview/TextPreview.vue";
import MarkdownPreview from "./file-preview/MarkdownPreview.vue";
import ImagePreview from "./file-preview/ImagePreview.vue";
import VideoPreview from "./file-preview/VideoPreview.vue";
import AudioPreview from "./file-preview/AudioPreview.vue";
import PdfPreview from "./file-preview/PdfPreview.vue";
import DocxPreview from "./file-preview/DocxPreview.vue";
import XlsxPreview from "./file-preview/XlsxPreview.vue";
import UnsupportedPreview from "./file-preview/UnsupportedPreview.vue";

const props = defineProps<{ projectId: string; path: string | null; hideHeader?: boolean }>();
const { t } = useI18n();

// Text content for the `text` and `markdown` kinds. Other kinds consume
// either a URL (raw stream) or fetch their own bytes inside the component,
// so we only load utf8 content when we actually need it.
const content = ref<string>("");
const loading = ref(false);
const error = ref<string | null>(null);

const fileName = computed(() => {
  if (!props.path) return null;
  const parts = props.path.split("/");
  return parts[parts.length - 1];
});

const kind = computed(() => (props.path ? filePreviewKind(fileName.value ?? "") : "unsupported"));

const rawUrl = computed(() =>
  props.path ? api.rawFileUrl(props.projectId, props.path) : "",
);

watch(
  () => [props.projectId, props.path],
  async () => {
    content.value = "";
    error.value = null;
    // Only block on the text/markdown kinds — they need utf8 content. Other
    // previews manage their own loading state and would otherwise show two
    // spinners stacked.
    if (kind.value !== "text" && kind.value !== "markdown") {
      loading.value = false;
      return;
    }
    if (!props.path) {
      loading.value = false;
      return;
    }
    loading.value = true;
    try {
      const r = await api.readFile(props.projectId, props.path);
      content.value = r.content;
    } catch (e: any) {
      error.value = e.message;
    } finally {
      loading.value = false;
    }
  },
  { immediate: true },
);
</script>

<template>
  <div class="file-viewer">
    <!-- File header -->
    <div class="viewer-header" v-if="fileName && !hideHeader">
      <span class="file-name">{{ fileName }}</span>
      <span class="file-path">{{ path }}</span>
    </div>

    <!-- Loading (text/markdown only) -->
    <div v-if="loading" class="viewer-state">
      <NSpin size="small" />
    </div>

    <!-- Error -->
    <div v-else-if="error" class="viewer-state error">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="1.5" />
        <path d="M10 6v5M10 13.5v.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      </svg>
      <span>{{ error }}</span>
    </div>

    <!-- Empty -->
    <div v-else-if="!path" class="viewer-state empty">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <path
          d="M4 4a2 2 0 012-2h8l6 6v12a2 2 0 01-2 2H6a2 2 0 01-2-2V4z"
          stroke="currentColor"
          stroke-width="1.3"
        />
        <path d="M14 2v6h6" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" />
      </svg>
      <span>{{ t('viewer.selectFile') }}</span>
    </div>

    <!-- Dispatch by kind -->
    <TextPreview v-else-if="kind === 'text'" :content="content" />
    <MarkdownPreview v-else-if="kind === 'markdown'" :content="content" />
    <ImagePreview v-else-if="kind === 'image'" :url="rawUrl" />
    <VideoPreview v-else-if="kind === 'video'" :url="rawUrl" />
    <AudioPreview v-else-if="kind === 'audio'" :url="rawUrl" />
    <PdfPreview v-else-if="kind === 'pdf'" :url="rawUrl" />
    <DocxPreview v-else-if="kind === 'docx'" :project-id="projectId" :path="path" />
    <XlsxPreview v-else-if="kind === 'xlsx'" :project-id="projectId" :path="path" />
    <UnsupportedPreview
      v-else
      :path="path!"
      :url="rawUrl"
      :reason="kind === 'pptx' ? t('viewer.unsupportedHint') : undefined"
    />
  </div>
</template>

<style scoped>
.file-viewer {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-deep);
}

/* ─── Header ─── */

.viewer-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-deep);
  flex-shrink: 0;
}

.file-name {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}

.file-path {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-faint);
}

/* ─── States ─── */

.viewer-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-muted);
}

.viewer-state.error {
  color: var(--rose);
  flex-direction: column;
  gap: 6px;
}

.viewer-state.empty {
  flex-direction: column;
  gap: 8px;
  opacity: 0.4;
}
</style>
