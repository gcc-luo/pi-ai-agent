<script setup lang="ts">
import { ref, watch, computed } from "vue";
import { NSpin } from "naive-ui";
import { api } from "../api/client.js";
import { useI18n } from "../i18n/index.js";

const props = defineProps<{ projectId: string; path: string | null; hideHeader?: boolean }>();
const { t } = useI18n();
const content = ref<string>("");
const loading = ref(false);
const error = ref<string | null>(null);

watch(
  () => [props.projectId, props.path],
  async () => {
    if (!props.path) {
      content.value = "";
      return;
    }
    loading.value = true;
    error.value = null;
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

const lines = computed(() => content.value.split("\n"));

const fileName = computed(() => {
  if (!props.path) return null;
  const parts = props.path.split("/");
  return parts[parts.length - 1];
});
</script>

<template>
  <div class="file-viewer">
    <!-- File header -->
    <div class="viewer-header" v-if="fileName && !hideHeader">
      <span class="file-name">{{ fileName }}</span>
      <span class="file-path">{{ path }}</span>
    </div>

    <!-- Loading -->
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

    <!-- Code content -->
    <div v-else class="code-block">
      <table class="code-table">
        <tbody>
          <tr v-for="(line, i) in lines" :key="i">
            <td class="line-num">{{ i + 1 }}</td>
            <td class="line-content"><pre>{{ line }}</pre></td>
          </tr>
        </tbody>
      </table>
    </div>
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

/* ─── Code Block ─── */

.code-block {
  flex: 1;
  overflow: auto;
  padding: 10px 0;
}

.code-table {
  width: 100%;
  border-collapse: collapse;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.7;
  tab-size: 2;
}

.code-table tr {
  transition: background var(--transition-fast);
}

.code-table tr:hover {
  background: var(--row-hover);
}

.line-num {
  width: 48px;
  padding: 0 12px 0 14px;
  text-align: right;
  color: var(--text-faint);
  user-select: none;
  vertical-align: top;
  font-variant-numeric: tabular-nums;
}

.line-content {
  padding-right: 14px;
  color: var(--text-primary);
  vertical-align: top;
}

.line-content pre {
  margin: 0;
  white-space: pre;
}
</style>
