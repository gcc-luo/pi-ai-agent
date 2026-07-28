<script setup lang="ts">
import { computed } from "vue";
import type { ArtifactItem } from "@pi-web-ui/shared";
import { filePreviewKind } from "../utils/file-kind.js";
import { api } from "../api/client.js";
import { useI18n } from "../i18n/index.js";

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

const kind = computed(() => filePreviewKind(props.artifact.name));
const canPreview = computed(() => kind.value !== "unsupported");
const rawUrl = computed(() => api.rawFileUrl(props.projectId, props.artifact.path));

const formattedSize = computed(() => {
  if (props.size == null) return "";
  return formatBytes(props.size);
});

const iconKind = computed(() => {
  switch (kind.value) {
    case "image": return "image";
    case "video": return "video";
    case "audio": return "audio";
    case "pdf": return "pdf";
    case "docx": return "office";
    case "xlsx": return "office";
    case "markdown": return "markdown";
    case "text": return "code";
    default: return "file";
  }
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
    <div class="artifact-icon" :class="`icon-${iconKind}`">
      <!-- Code / text file -->
      <svg v-if="iconKind === 'code'" width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M4 2h7l4 4v10a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" />
        <path d="M11 2v4h4" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" />
        <path d="M7 10l-2 2 2 2M11 10l2 2-2 2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <!-- Image -->
      <svg v-else-if="iconKind === 'image'" width="18" height="18" viewBox="0 0 18 18" fill="none">
        <rect x="2" y="2" width="14" height="14" rx="2" stroke="currentColor" stroke-width="1.3" />
        <circle cx="6.5" cy="6.5" r="1.5" stroke="currentColor" stroke-width="1.2" />
        <path d="M2 13l4-4 3 3 2-2 5 5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <!-- Video -->
      <svg v-else-if="iconKind === 'video'" width="18" height="18" viewBox="0 0 18 18" fill="none">
        <rect x="2" y="3" width="14" height="12" rx="2" stroke="currentColor" stroke-width="1.3" />
        <path d="M7 7l5 2.5L7 12V7z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" />
      </svg>
      <!-- Audio -->
      <svg v-else-if="iconKind === 'audio'" width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M3 6v6h3l4 4V2L6 6H3z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" />
        <path d="M13 6.5a3 3 0 010 5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
      </svg>
      <!-- PDF -->
      <svg v-else-if="iconKind === 'pdf'" width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M4 2h7l4 4v10a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" />
        <path d="M11 2v4h4" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" />
        <text x="5" y="14" font-size="6" font-weight="700" fill="currentColor" font-family="var(--font-mono)">PDF</text>
      </svg>
      <!-- Office -->
      <svg v-else-if="iconKind === 'office'" width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M4 2h7l4 4v10a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" />
        <path d="M11 2v4h4" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" />
        <path d="M6 9h6M6 12h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
      </svg>
      <!-- Markdown -->
      <svg v-else-if="iconKind === 'markdown'" width="18" height="18" viewBox="0 0 18 18" fill="none">
        <rect x="2" y="3" width="14" height="12" rx="2" stroke="currentColor" stroke-width="1.3" />
        <text x="4.5" y="12.5" font-size="7" font-weight="700" fill="currentColor" font-family="var(--font-mono)">M</text>
      </svg>
      <!-- Generic file -->
      <svg v-else width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M4 2h7l4 4v10a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" />
        <path d="M11 2v4h4" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" />
      </svg>
    </div>
    <div class="artifact-info">
      <div class="artifact-name-row">
        <span class="artifact-name">{{ artifact.name }}</span>
        <span v-if="formattedSize" class="artifact-size">{{ formattedSize }}</span>
      </div>
      <div class="artifact-meta">
        <span class="artifact-mime">{{ artifact.mimeType }}</span>
        <span v-if="!exists" class="artifact-missing-label">{{ t('artifact.fileNotFound') }}</span>
      </div>
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
        :download="artifact.name"
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
  gap: 12px;
  padding: 10px 14px;
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

.artifact-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  border-radius: var(--radius-sm, 6px);
  background: var(--bg-elevated, var(--bg-deep));
  color: var(--text-muted);
}
.artifact-icon.icon-code { color: var(--primary-color, #00b894); }
.artifact-icon.icon-image { color: #8b5cf6; }
.artifact-icon.icon-video { color: #ec4899; }
.artifact-icon.icon-audio { color: #f59e0b; }
.artifact-icon.icon-pdf { color: #ef4444; }
.artifact-icon.icon-office { color: #3b82f6; }
.artifact-icon.icon-markdown { color: #6366f1; }

.artifact-info {
  flex: 1;
  min-width: 0;
}

.artifact-name-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.artifact-name {
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

.artifact-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 2px;
}

.artifact-mime {
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
  padding: 4px 10px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm, 6px);
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 500;
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
