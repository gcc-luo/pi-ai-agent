<script setup lang="ts">
import { ref, watch, computed } from "vue";
import { NModal, NTabs, NTabPane, NSpin, NEmpty } from "naive-ui";
import { api } from "../api/client.js";
import type { KbFileDto, KbChunkDto } from "@pi-web-ui/shared";

const props = defineProps<{
  show: boolean;
  fileId: string | null;
}>();

const emit = defineEmits<{
  (e: "close"): void;
}>();

const file = ref<KbFileDto | null>(null);
const content = ref<string | null>(null);
const chunks = ref<KbChunkDto[]>([]);
const loading = ref(false);
const contentLoading = ref(false);
const chunksLoading = ref(false);
const error = ref("");
const activeTab = ref<"meta" | "preview" | "chunks">("meta");

const isTextPreviewable = computed(() => {
  if (!file.value) return false;
  return ["txt", "md"].includes(file.value.ext);
});

const statusColor = computed(() => {
  switch (file.value?.status) {
    case "ready": return "var(--green)";
    case "parsing": return "var(--amber)";
    case "failed": return "var(--rose)";
    default: return "var(--text-muted)";
  }
});

const statusLabel = computed(() => {
  switch (file.value?.status) {
    case "ready": return "就绪";
    case "parsing": return "解析中";
    case "failed": return "失败";
    case "pending": return "等待中";
    default: return file.value?.status ?? "";
  }
});

const sourceLabel = computed(() => {
  if (!file.value) return "";
  return file.value.source === "created" ? "创建" : "导入";
});

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(ts: number | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max) + "…";
}

async function loadData(id: string) {
  loading.value = true;
  error.value = "";
  file.value = null;
  content.value = null;
  chunks.value = [];

  try {
    file.value = await api.getKbFile(id);
  } catch (e: any) {
    error.value = e?.message ?? "加载文件信息失败";
    loading.value = false;
    return;
  }

  // Load content and chunks in parallel
  const tasks: Promise<void>[] = [];

  if (isTextPreviewable.value) {
    tasks.push(
      (async () => {
        contentLoading.value = true;
        try {
          const res = await api.getKbFileContent(id);
          content.value = res.content;
        } catch {
          content.value = null;
        } finally {
          contentLoading.value = false;
        }
      })(),
    );
  }

  tasks.push(
    (async () => {
      chunksLoading.value = true;
      try {
        chunks.value = await api.getKbFileChunks(id);
      } catch {
        chunks.value = [];
      } finally {
        chunksLoading.value = false;
      }
    })(),
  );

  await Promise.all(tasks);
  loading.value = false;
}

watch(
  () => [props.show, props.fileId] as const,
  ([visible, id]) => {
    if (visible && id) {
      activeTab.value = "meta";
      loadData(id);
    } else {
      file.value = null;
      content.value = null;
      chunks.value = [];
      error.value = "";
    }
  },
  { immediate: true },
);
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    :style="{ width: '720px', maxWidth: '92vw' }"
    :title="file ? file.name : '文件详情'"
    :bordered="false"
    :mask-closable="true"
    @update:show="(v: boolean) => { if (!v) emit('close'); }"
  >
    <template #header-extra v-if="file">
      <span class="ext-badge">.{{ file.ext }}</span>
      <span class="status-badge" :style="{ color: statusColor, borderColor: statusColor }">
        {{ statusLabel }}
      </span>
    </template>

    <!-- Loading state -->
    <div v-if="loading" class="loading-container">
      <NSpin size="medium" />
    </div>

    <!-- Error state -->
    <div v-else-if="error" class="error-container">
      <NEmpty description="加载失败">
        <template #extra>
          <div class="error-text">{{ error }}</div>
        </template>
      </NEmpty>
    </div>

    <!-- Content -->
    <div v-else-if="file" class="dialog-body">
      <NTabs v-model:value="activeTab" type="line" size="small" animated>
        <NTabPane name="meta" tab="元数据">
          <div class="meta-grid">
            <div class="meta-item">
              <span class="meta-key">大小</span>
              <span class="meta-val">{{ formatSize(file.size) }}</span>
            </div>
            <div class="meta-item">
              <span class="meta-key">字符数</span>
              <span class="meta-val">{{ file.charCount != null ? file.charCount.toLocaleString() : "—" }}</span>
            </div>
            <div class="meta-item">
              <span class="meta-key">页数</span>
              <span class="meta-val">{{ file.pageCount != null ? file.pageCount : "—" }}</span>
            </div>
            <div class="meta-item">
              <span class="meta-key">分块数</span>
              <span class="meta-val">{{ file.chunkCount != null ? file.chunkCount : "—" }}</span>
            </div>
            <div class="meta-item">
              <span class="meta-key">最近解析</span>
              <span class="meta-val">{{ formatTime(file.lastParsedAt) }}</span>
            </div>
            <div class="meta-item">
              <span class="meta-key">来源</span>
              <span class="meta-val">{{ sourceLabel }}</span>
            </div>
          </div>
          <div v-if="file.status === 'failed' && file.failReason" class="fail-reason">
            {{ file.failReason }}
          </div>
        </NTabPane>

        <NTabPane name="preview" tab="内容预览">
          <div v-if="isTextPreviewable">
            <NSpin v-if="contentLoading" size="small" class="inline-spin" />
            <pre v-else-if="content !== null" class="content-preview">{{ content }}</pre>
            <div v-else class="preview-unavailable">预览加载失败</div>
          </div>
          <div v-else class="preview-unavailable">
            预览不可用（仅支持 txt / md 文件）
          </div>
        </NTabPane>

        <NTabPane name="chunks" :tab="`分块列表${chunks.length ? ' · ' + chunks.length : ''}`">
          <NSpin v-if="chunksLoading" size="small" class="inline-spin" />
          <div v-else-if="chunks.length === 0" class="no-chunks">暂无分块</div>
          <div v-else class="chunk-list">
            <div v-for="chunk in chunks" :key="chunk.id" class="chunk-card">
              <div class="chunk-header">
                <span class="chunk-seq">#{{ chunk.seq }}</span>
                <span v-if="chunk.titlePath" class="chunk-title">{{ chunk.titlePath }}</span>
                <span v-if="chunk.pageStart != null" class="chunk-pages">
                  p.{{ chunk.pageStart }}{{ chunk.pageEnd != null && chunk.pageEnd !== chunk.pageStart ? `–${chunk.pageEnd}` : "" }}
                </span>
              </div>
              <p class="chunk-content">{{ truncate(chunk.content, 200) }}</p>
              <div class="chunk-footer">
                <span class="chunk-chars">{{ chunk.charCount.toLocaleString() }} 字符</span>
              </div>
            </div>
          </div>
        </NTabPane>
      </NTabs>
    </div>
  </NModal>
</template>

<style scoped>
.ext-badge {
  flex-shrink: 0;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
  border: 1px solid var(--border-default);
  color: var(--text-secondary);
}
.status-badge {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  padding: 1px 8px;
  border-radius: 99px;
  border: 1px solid;
  margin-left: 8px;
}

.loading-container {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 60px 0;
}
.error-container {
  padding: 40px 0;
}
.error-text {
  font-size: 12px;
  color: var(--rose);
  margin-top: 8px;
}

.dialog-body {
  /* NModal card body already has padding; just provide a min height so
     tabs don't collapse when switching panes */
  min-height: 320px;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
}
.dialog-body :deep(.n-tabs-pane) {
  padding-top: 12px;
}

.meta-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px 24px;
}
.meta-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.meta-key {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
}
.meta-val {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--text-primary);
  font-weight: 500;
}
.fail-reason {
  margin-top: 10px;
  padding: 8px 10px;
  border-radius: var(--radius-md);
  background: var(--rose-dim);
  color: var(--rose);
  font-size: 12px;
  line-height: 1.5;
}

/* Preview */
.content-preview {
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-primary);
  background: var(--bg-elevated);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  padding: 12px;
  max-height: 50vh;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
}
.preview-unavailable {
  font-size: 12px;
  color: var(--text-muted);
  padding: 24px;
  text-align: center;
  background: var(--bg-elevated);
  border: 1px dashed var(--border-default);
  border-radius: var(--radius-md);
}
.inline-spin {
  display: flex;
  justify-content: center;
  padding: 24px 0;
}

/* Chunks */
.no-chunks {
  font-size: 12px;
  color: var(--text-muted);
  text-align: center;
  padding: 24px 0;
}
.chunk-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 50vh;
  overflow-y: auto;
  padding-right: 4px;
}
.chunk-card {
  padding: 10px 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  transition: border-color var(--transition-fast);
}
.chunk-card:hover {
  border-color: var(--border-active);
}
.chunk-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  flex-wrap: wrap;
}
.chunk-seq {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
  color: var(--accent);
}
.chunk-title {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chunk-pages {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-muted);
  margin-left: auto;
  flex-shrink: 0;
}
.chunk-content {
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary);
  margin: 0;
  word-break: break-word;
}
.chunk-footer {
  margin-top: 6px;
}
.chunk-chars {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-muted);
}
</style>
