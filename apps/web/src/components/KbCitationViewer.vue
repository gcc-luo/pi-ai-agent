<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { NSpin } from "naive-ui";
import type { KbChunkDto, KbFileDto } from "@pi-web-ui/shared";
import { api } from "../api/client.js";
import { useI18n } from "../i18n/index.js";
import { renderMarkdown } from "../utils/markdown.js";
import { highlightCitationText } from "../utils/kb-citation-highlight.js";
import type { KbCitationMeta } from "../utils/kb-context.js";

const props = defineProps<{ citation: KbCitationMeta }>();
const { t } = useI18n();

const file = ref<KbFileDto | null>(null);
const fileContent = ref<string | null>(null);
const chunks = ref<KbChunkDto[]>([]);
const resolvedKbName = ref("");
const loading = ref(false);
const error = ref("");
const documentRoot = ref<HTMLElement | null>(null);
const highlightFound = ref(false);
let requestId = 0;

const hasOriginalText = computed(() => fileContent.value !== null);
const isMarkdown = computed(() => file.value?.ext.toLowerCase() === "md");
const formattedText = computed(() => {
  if (fileContent.value === null) return "";
  if (isMarkdown.value) return renderMarkdown(fileContent.value);
  return `<pre class="kb-plain-text">${escapeHtml(fileContent.value)}</pre>`;
});
const renderedChunks = computed(() => chunks.value
  .filter((chunk) => chunk.content.trim())
  .map((chunk) => ({ ...chunk, html: renderMarkdown(chunk.content) })));
const targetChunk = computed(() => chunks.value.find((chunk) =>
  (props.citation.segmentId && chunk.segmentId === props.citation.segmentId)
  || chunk.id === props.citation.chunkId,
) ?? null);
const highlightText = computed(() => props.citation.content || targetChunk.value?.content || "");
const pageLabel = computed(() => {
  if (props.citation.pageStart == null) return "";
  const end = props.citation.pageEnd;
  return end != null && end !== props.citation.pageStart
    ? t("kb.context.pageRange", { start: props.citation.pageStart, end })
    : t("kb.context.pageSingle", { n: props.citation.pageStart });
});

async function resolveFileId(citation: KbCitationMeta): Promise<{ fileId: string; kbName: string }> {
  if (citation.fileId) return { fileId: citation.fileId, kbName: citation.kbName };

  const knowledgeBases = citation.kbId
    ? [await api.getKnowledgeBase(citation.kbId)]
    : (await api.listKnowledgeBases()).filter((kb) => kb.name === citation.kbName);
  for (const kb of knowledgeBases) {
    const page = await api.listKbFiles(kb.id, { search: citation.fileName, pageSize: 100 });
    const match = page.items.find((candidate) => candidate.name === citation.fileName);
    if (match) return { fileId: match.id, kbName: kb.name };
  }
  throw new Error(t("kb.chat.citation.fileUnavailable"));
}

async function loadCitation(citation: KbCitationMeta) {
  const currentRequest = ++requestId;
  loading.value = true;
  error.value = "";
  file.value = null;
  fileContent.value = null;
  chunks.value = [];
  resolvedKbName.value = citation.kbName;
  highlightFound.value = false;

  try {
    const resolved = await resolveFileId(citation);
    const detail = await api.getKbFile(resolved.fileId);
    const chunkPromise = api.getKbFileChunks(resolved.fileId).catch(() => [] as KbChunkDto[]);
    let textContent: string | null = null;
    if (detail.ext === "txt" || detail.ext === "md") {
      try {
        textContent = (await api.getKbFileContent(resolved.fileId)).content;
      } catch {
        // A reparsing or storage issue can still leave readable indexed chunks.
      }
    }
    const fileChunks = await chunkPromise;
    if (currentRequest !== requestId) return;

    file.value = detail;
    resolvedKbName.value = resolved.kbName;
    fileContent.value = textContent;
    chunks.value = fileChunks;
    loading.value = false;

    await nextTick();
    if (currentRequest !== requestId) return;
    if (documentRoot.value && highlightText.value) {
      const mark = highlightCitationText(documentRoot.value, highlightText.value);
      highlightFound.value = Boolean(mark);
      if (mark) mark.scrollIntoView?.({ block: "center", behavior: "smooth" });
    }
  } catch (loadError) {
    if (currentRequest !== requestId) return;
    error.value = loadError instanceof Error ? loadError.message : t("kb.chat.citation.loadFailed");
  } finally {
    if (currentRequest === requestId) loading.value = false;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

watch(() => props.citation, (citation) => void loadCitation(citation), { immediate: true });
onBeforeUnmount(() => { requestId++; });
</script>

<template>
  <div class="kb-citation-viewer">
    <div class="citation-file-meta" v-if="file">
      <span class="file-type">{{ file.ext.toUpperCase() }}</span>
      <span>{{ resolvedKbName }}</span>
      <span class="meta-separator">·</span>
      <span>{{ file.status === "ready" ? t("kb.file.status.ready") : file.status }}</span>
      <span v-if="pageLabel" class="page-label">{{ pageLabel }}</span>
    </div>

    <div v-if="loading" class="citation-state">
      <NSpin size="small" />
      <span>{{ t("kb.chat.citation.loading") }}</span>
    </div>
    <div v-else-if="error" class="citation-state error" role="alert">
      <span>{{ error }}</span>
    </div>
    <div v-else-if="file" class="citation-scroll">
      <article class="citation-document">
        <div class="document-breadcrumb">{{ resolvedKbName }} <span>/</span> {{ file.name }}</div>
        <h1>{{ file.name.replace(/\.[^.]+$/, "") }}</h1>
        <div v-if="citation.titlePath || pageLabel" class="document-location">
          <span v-if="citation.titlePath">{{ citation.titlePath }}</span>
          <span v-if="citation.titlePath && pageLabel" class="meta-separator">·</span>
          <span v-if="pageLabel">{{ pageLabel }}</span>
        </div>
        <div class="citation-callout">
          <span class="callout-dot" />
          <span>{{ t("kb.chat.citation.located") }}</span>
        </div>

        <div
          v-if="hasOriginalText"
          ref="documentRoot"
          class="document-content markdown-content"
          v-html="formattedText"
        />
        <div v-else-if="renderedChunks.length" ref="documentRoot" class="document-content chunk-content">
          <section
            v-for="chunk in renderedChunks"
            :key="chunk.id"
            class="document-chunk"
            :class="{ 'target-chunk': targetChunk?.id === chunk.id }"
          >
            <h2 v-if="chunk.titlePath">{{ chunk.titlePath }}</h2>
            <div v-html="chunk.html" />
            <div v-if="chunk.pageStart != null" class="chunk-page">
              {{ chunk.pageEnd != null && chunk.pageEnd !== chunk.pageStart
                ? t("kb.context.pageRange", { start: chunk.pageStart, end: chunk.pageEnd })
                : t("kb.context.pageSingle", { n: chunk.pageStart }) }}
            </div>
          </section>
        </div>
        <div v-else class="citation-state empty">
          {{ t("kb.chat.citation.noText") }}
        </div>
        <div v-if="!loading && !error && highlightText && !highlightFound" class="highlight-notice">
          {{ t("kb.chat.citation.highlightUnavailable") }}
        </div>
      </article>
    </div>
  </div>
</template>

<style scoped>
.kb-citation-viewer {
  display: flex;
  height: 100%;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-deep);
}

.citation-file-meta {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
  min-height: 42px;
  padding: 6px 16px;
  border-bottom: 1px solid var(--border-subtle);
  color: var(--text-muted);
  font-size: 10px;
}

.file-type {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  min-width: 23px;
  height: 24px;
  padding: 0 4px;
  border-radius: 4px;
  background: var(--accent-dim);
  color: var(--accent);
  font-family: var(--font-mono);
  font-size: 8px;
  font-weight: 700;
}

.meta-separator {
  color: var(--text-faint);
}

.page-label {
  margin-left: auto;
  color: var(--text-secondary);
  font-family: var(--font-mono);
}

.citation-state {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  gap: 9px;
  padding: 24px;
  color: var(--text-muted);
  font-size: 12px;
  text-align: center;
}

.citation-state.error {
  color: var(--rose);
}

.citation-scroll {
  min-height: 0;
  flex: 1;
  overflow: auto;
  padding: 22px clamp(18px, 3vw, 32px) 36px;
}

.citation-document {
  max-width: 720px;
  margin: 0 auto;
  color: var(--text-primary);
  font-size: 12px;
  line-height: 1.8;
  overflow-wrap: anywhere;
}

.document-breadcrumb {
  overflow: hidden;
  margin-bottom: 18px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 9px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.document-breadcrumb span {
  padding: 0 5px;
  color: var(--text-faint);
}

.citation-document h1 {
  margin: 0 0 7px;
  color: var(--text-primary);
  font-size: 20px;
  font-weight: 650;
  letter-spacing: -0.025em;
  line-height: 1.35;
}

.document-location {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-bottom: 13px;
  color: var(--text-secondary);
  font-size: 10px;
}

.citation-callout {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0 0 18px;
  padding: 8px 10px;
  border: 1px solid color-mix(in srgb, var(--accent) 22%, transparent);
  border-radius: var(--radius-sm);
  background: var(--accent-dim);
  color: var(--accent);
  font-size: 10px;
}

.callout-dot {
  width: 5px;
  height: 5px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: currentColor;
}

.document-content :deep(p) {
  margin: 0 0 0.75em;
  color: var(--text-secondary);
}

.document-content :deep(h1),
.document-content :deep(h2),
.document-content :deep(h3),
.document-content :deep(h4),
.document-chunk h2 {
  margin: 1.15em 0 0.45em;
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.45;
}

.document-content :deep(h1) {
  font-size: 18px;
}

.document-content :deep(h3),
.document-content :deep(h4) {
  font-size: 12px;
}

.document-content :deep(ul),
.document-content :deep(ol) {
  margin: 0.35em 0 0.8em;
  padding-left: 1.5em;
  color: var(--text-secondary);
}

.document-content :deep(li) {
  margin: 0.15em 0;
}

.document-content :deep(li::marker) {
  color: var(--accent);
}

.document-content :deep(blockquote) {
  margin: 0.5em 0 0.8em;
  padding: 0.2em 0 0.2em 12px;
  border-left: 2px solid var(--border-active);
  color: var(--text-secondary);
}

.document-content :deep(code) {
  border-radius: 3px;
  background: var(--bg-elevated);
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 0.9em;
}

.document-content :deep(pre) {
  overflow: auto;
  padding: 10px 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--bg-void);
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.7;
  white-space: pre-wrap;
}

.document-content :deep(.kb-citation-highlight) {
  padding: 1px 2px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--accent) 22%, transparent);
  box-decoration-break: clone;
  color: var(--text-primary);
  outline: 1px solid color-mix(in srgb, var(--accent) 44%, transparent);
}

.document-chunk {
  margin: 0 0 14px;
  padding: 9px 11px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
}

.document-chunk.target-chunk {
  border-color: color-mix(in srgb, var(--accent) 30%, var(--border-default));
  background: color-mix(in srgb, var(--accent) 5%, transparent);
}

.document-chunk h2 {
  margin-top: 0;
}

.chunk-page {
  margin-top: 6px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 9px;
}

.highlight-notice {
  margin: 16px 0 0;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
  color: var(--text-muted);
  font-size: 10px;
}

@media (prefers-reduced-motion: reduce) {
  .document-content :deep(*) {
    scroll-behavior: auto !important;
  }
}
</style>
