<script setup lang="ts">
import { computed } from "vue";
import { fileIconKind, type FileIconKind } from "../utils/file-kind.js";

const props = withDefaults(defineProps<{
  filename: string;
  size?: number;
}>(), {
  size: 16,
});

const kind = computed<FileIconKind>(() => fileIconKind(props.filename));
const label = computed(() => {
  switch (kind.value) {
    case "markdown": return "M";
    case "javascript": return "JS";
    case "typescript": return "TS";
    case "python": return "Py";
    case "json": return "{}";
    case "pdf": return "PDF";
    case "word": return "W";
    case "excel": return "X";
    case "powerpoint": return "P";
    case "data": return "CSV";
    case "text": return "TXT";
    default: return null;
  }
});
</script>

<template>
  <svg
    class="file-type-icon"
    :class="`file-type-icon--${kind}`"
    :width="size"
    :height="size"
    viewBox="0 0 18 18"
    fill="none"
    aria-hidden="true"
  >
    <path
      class="file-paper"
      d="M4.25 1.75h6.5L15 6v10.25a1 1 0 01-1 1H4a1 1 0 01-1-1V2.75a1 1 0 011-1z"
      fill="currentColor"
      fill-opacity=".1"
      stroke="currentColor"
      stroke-width="1.3"
      stroke-linejoin="round"
    />
    <path d="M10.75 1.9V6h4.05" fill="currentColor" fill-opacity=".22" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" />

    <template v-if="kind === 'image'">
      <circle cx="6.5" cy="8.5" r="1.2" fill="currentColor" />
      <path d="M4.5 14l3.1-3.1 2.2 2.1 1.4-1.4 2.3 2.4" fill="currentColor" fill-opacity=".18" stroke="currentColor" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" />
    </template>
    <template v-else-if="kind === 'video'">
      <circle cx="9" cy="10.5" r="3.2" fill="currentColor" fill-opacity=".16" />
      <path d="M7.8 8.7l3.1 1.8-3.1 1.8V8.7z" fill="currentColor" />
    </template>
    <template v-else-if="kind === 'audio'">
      <path d="M5 8.5v4h2l3 2.2V6.3L7 8.5H5z" fill="currentColor" fill-opacity=".16" stroke="currentColor" stroke-width="1.05" stroke-linejoin="round" />
      <path d="M11.5 8.5a2.8 2.8 0 010 4" stroke="currentColor" stroke-width="1.05" stroke-linecap="round" />
    </template>
    <template v-else-if="kind === 'code'">
      <rect x="4.6" y="8.1" width="8.8" height="5.2" rx="1.3" fill="currentColor" fill-opacity=".16" />
      <path d="M7.1 9.6l-1.1 1.1 1.1 1.1M10.9 9.6l1.1 1.1-1.1 1.1" stroke="currentColor" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" />
    </template>
    <template v-else-if="kind === 'web'">
      <rect x="4.6" y="8.1" width="8.8" height="5.2" rx="1.3" fill="currentColor" fill-opacity=".16" />
      <path d="M7 9.6l-1.1 1.1L7 11.8M11 9.6l1.1 1.1-1.1 1.1M10 9.2l-2 3.8" stroke="currentColor" stroke-width=".95" stroke-linecap="round" stroke-linejoin="round" />
    </template>
    <template v-else-if="kind === 'style'">
      <rect x="4.6" y="8.1" width="8.8" height="5.2" rx="1.3" fill="currentColor" fill-opacity=".16" />
      <path d="M6.2 9.6h5.6M6.2 11.8h3.7" stroke="currentColor" stroke-width="1.05" stroke-linecap="round" />
    </template>
    <template v-else-if="kind === 'config'">
      <circle cx="9" cy="10.5" r="2.1" fill="currentColor" fill-opacity=".16" stroke="currentColor" stroke-width="1.05" />
      <path d="M9 7.5v1M9 12.5v1M6 10.5h1M11 10.5h1M6.9 8.4l.7.7M10.4 11.9l.7.7M11.1 8.4l-.7.7M7.6 11.9l-.7.7" stroke="currentColor" stroke-width=".9" stroke-linecap="round" />
    </template>
    <g v-else-if="label">
      <rect x="4.6" y="8.1" width="8.8" height="5.2" rx="1.3" fill="currentColor" fill-opacity=".16" />
      <text
        x="9"
        y="12.8"
        text-anchor="middle"
        :font-size="label.length > 2 ? 4.1 : 6.2"
        font-weight="700"
        fill="currentColor"
        font-family="var(--font-mono, monospace)"
      >{{ label }}</text>
    </g>
    <path
      v-else
      d="M6 10h6M6 12.5h4"
      stroke="currentColor"
      stroke-width="1.1"
      stroke-linecap="round"
    />
  </svg>
</template>

<style scoped>
.file-type-icon {
  display: block;
  flex: 0 0 auto;
  overflow: visible;
  filter: drop-shadow(0 0.5px 0.5px rgba(15, 23, 42, 0.08));
}

.file-type-icon--markdown { color: #6366f1; }
.file-type-icon--javascript { color: #ca8a04; }
.file-type-icon--typescript { color: #2563eb; }
.file-type-icon--python { color: #3776ab; }
.file-type-icon--json { color: #64748b; }
.file-type-icon--web { color: #f97316; }
.file-type-icon--style { color: #0891b2; }
.file-type-icon--data { color: #059669; }
.file-type-icon--image { color: #8b5cf6; }
.file-type-icon--video { color: #db2777; }
.file-type-icon--audio { color: #d97706; }
.file-type-icon--pdf { color: #dc2626; }
.file-type-icon--word { color: #2563eb; }
.file-type-icon--excel { color: #15803d; }
.file-type-icon--powerpoint { color: #c2410c; }
.file-type-icon--archive { color: #a16207; }
.file-type-icon--config { color: #9333ea; }
.file-type-icon--code { color: #059669; }
.file-type-icon--text { color: #64748b; }
.file-type-icon--generic { color: var(--text-muted); }
</style>
