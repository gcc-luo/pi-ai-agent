<script setup lang="ts">
import { computed } from "vue";
import type { ArtifactItem } from "@pi-web-ui/shared";
import { filePreviewKind } from "../utils/file-kind.js";
import { api } from "../api/client.js";
import { useI18n } from "../i18n/index.js";
import FileTypeIcon from "./FileTypeIcon.vue";

const props = defineProps<{
  projectId: string;
  artifact: ArtifactItem;
  exists: boolean;
  size: number | null;
}>();

const emit = defineEmits<{
  (e: "preview", path: string): void;
}>();

const { t } = useI18n();

const fileName = computed(() => {
  const normalizedPath = props.artifact.path.replaceAll("\\\\", "/");
  return normalizedPath.split("/").pop() || props.artifact.name;
});
const kind = computed(() => filePreviewKind(fileName.value));
const canPreview = computed(() => kind.value !== "unsupported");
const rawUrl = computed(() => api.rawFileUrl(props.projectId, props.artifact.path));

const formattedSize = computed(() => {
  if (props.size == null) return "";
  return formatBytes(props.size);
});

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), units.length - 1);
  const value = bytes / Math.pow(k, i);
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}
</script>

<template>
  <div class="artifact-card" :class="{ 'artifact-missing': !exists }">
    <FileTypeIcon class="artifact-icon" :filename="fileName" :size="16" />
    <div class="artifact-info">
      <span class="artifact-name">{{ fileName }}</span>
      <span v-if="formattedSize" class="artifact-size">{{ formattedSize }}</span>
      <span class="artifact-mime">{{ artifact.mimeType }}</span>
      <span v-if="!exists" class="artifact-missing-label">{{ t('artifact.fileNotFound') }}</span>
    </div>
    <div class="artifact-actions">
      <button
        v-if="canPreview && exists"
        class="artifact-btn"
        :title="t('artifact.preview')"
        @click="emit('preview', artifact.path)"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M1 7s2.5-4.5 6-4.5S13 7 13 7s-2.5 4.5-6 4.5S1 7 1 7z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" />
          <circle cx="7" cy="7" r="2" stroke="currentColor" stroke-width="1.2" />
        </svg>
        <span>{{ t('artifact.preview') }}</span>
      </button>
      <a
        v-if="exists"
        class="artifact-btn artifact-download"
        :href="rawUrl"
        :download="fileName"
        :title="t('artifact.download')"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M7 2v7M4 7l3 3 3-3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
          <path d="M2 10v2h10v-2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <span>{{ t('artifact.download') }}</span>
      </a>
    </div>
  </div>
</template>

<style scoped>
.artifact-card {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 30px;
  padding: 4px 8px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md, 8px);
  background: var(--bg-surface);
  transition: border-color 0.15s, box-shadow 0.15s;
}
.artifact-card:hover {
  border-color: var(--accent, var(--primary-color));
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}
.artifact-card.artifact-missing {
  opacity: 0.55;
  border-style: dashed;
}

.artifact-info {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.artifact-name {
  min-width: 0;
  flex: 1;
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.artifact-size {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.artifact-mime {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--text-muted);
}

.artifact-missing-label {
  font-size: 11px;
  color: var(--danger-color, #e53935);
  font-weight: 500;
}

.artifact-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.artifact-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 7px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  text-decoration: none;
  white-space: nowrap;
}
.artifact-btn:hover {
  background: var(--bg-hover, var(--bg-elevated));
  color: var(--primary-color, var(--text-primary));
  border-color: var(--primary-color, var(--border-default));
}

.artifact-download {
  color: var(--text-muted);
}
.artifact-download:hover {
  color: var(--primary-color);
}
</style>
