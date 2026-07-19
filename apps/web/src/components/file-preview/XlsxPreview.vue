<script setup lang="ts">
import { ref, watch } from "vue";
import { api } from "../../api/client.js";
import { useI18n } from "../../i18n/index.js";

// .xlsx → HTML table via SheetJS. SheetJS is dynamically imported on first
// use so its ~700KB never lands in the main bundle for users who never open
// a spreadsheet.

const props = defineProps<{ projectId: string; path: string }>();

interface SheetView { name: string; html: string; }
const sheets = ref<SheetView[]>([]);
const activeSheet = ref(0);
const loading = ref(false);
const error = ref<string | null>(null);
const { t } = useI18n();

async function load() {
  loading.value = true;
  error.value = null;
  sheets.value = [];
  try {
    const res = await fetch(api.rawFileUrl(props.projectId, props.path));
    if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
    const buf = await res.arrayBuffer();
    const XLSX = await import("xlsx");
    const wb = XLSX.read(buf, { type: "array" });
    sheets.value = wb.SheetNames.map((name) => {
      const ws = wb.Sheets[name];
      if (!ws) return { name, html: "" };
      // render as HTML table; suppress inline styles for a clean look
      const html = XLSX.utils.sheet_to_html(ws, { id: `sheet-${name}`, editable: false });
      return { name, html };
    });
    activeSheet.value = 0;
  } catch (e: any) {
    error.value = e?.message ?? String(e);
  } finally {
    loading.value = false;
  }
}

watch(() => [props.projectId, props.path], load, { immediate: true });
</script>

<template>
  <div class="xlsx-preview">
    <div v-if="sheets.length > 1" class="sheet-tabs">
      <button
        v-for="(s, i) in sheets"
        :key="s.name"
        class="sheet-tab"
        :class="{ active: i === activeSheet }"
        @click="activeSheet = i"
      >{{ s.name }}</button>
    </div>
    <div v-if="loading" class="state">{{ t('viewer.rendering') }}</div>
    <div v-else-if="error" class="state error">{{ error }}</div>
    <div v-else-if="sheets.length" class="sheet-wrap" v-html="sheets[activeSheet]?.html ?? ''" />
    <div v-else class="state">{{ t('viewer.emptyWorkbook') }}</div>
  </div>
</template>

<style scoped>
.xlsx-preview {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-void);
}
.sheet-tabs {
  display: flex;
  gap: 1px;
  padding: 6px 8px 0;
  background: var(--bg-deep);
  border-bottom: 1px solid var(--border-default);
  overflow-x: auto;
  flex-shrink: 0;
}
.sheet-tab {
  padding: 5px 12px;
  border: 1px solid var(--border-default);
  border-bottom: none;
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  background: transparent;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 11px;
  cursor: pointer;
  transition: all var(--transition-fast);
}
.sheet-tab.active {
  background: var(--bg-surface);
  color: var(--text-primary);
}
.sheet-wrap {
  flex: 1;
  overflow: auto;
  padding: 8px 12px;
}
.sheet-wrap :deep(table) { border-collapse: collapse; font-family: var(--font-mono); font-size: 11.5px; }
.sheet-wrap :deep(td),
.sheet-wrap :deep(th) {
  border: 1px solid var(--border-subtle);
  padding: 3px 7px;
  white-space: pre-wrap;
  max-width: 480px;
}
.sheet-wrap :deep(tr:first-child td) { background: var(--bg-elevated); font-weight: 600; }

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
