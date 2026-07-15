<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { NModal, NButton } from "naive-ui";
import { useKbFileStore } from "../stores/kb-file.js";
import { useI18n } from "../i18n/index.js";

const props = defineProps<{
  show: boolean;
  kbId: string;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "done"): void;
}>();

const kbFileStore = useKbFileStore();
const { t } = useI18n();

const selectedFiles = ref<File[]>([]);
const phase = ref<"idle" | "importing" | "done">("idle");
const resultMessage = ref("");
const errorMessage = ref("");
const dragOver = ref(false);

const ALLOWED_EXT = new Set(["txt", "md", "pdf", "docx"]);
const MAX_FILES = 20;
const MAX_SIZE = 50 * 1024 * 1024; // 50MB

function getExt(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function addFiles(fileList: FileList | File[]) {
  const newFiles: File[] = [];
  const existing = new Set(selectedFiles.value.map((f) => f.name));

  for (const file of Array.from(fileList)) {
    const ext = getExt(file.name);
    if (!ALLOWED_EXT.has(ext)) continue;
    if (file.size > MAX_SIZE) continue;
    if (existing.has(file.name)) continue;
    newFiles.push(file);
    existing.add(file.name);
  }

  const combined = [...selectedFiles.value, ...newFiles];
  selectedFiles.value = combined.slice(0, MAX_FILES);
}

function removeFile(index: number) {
  selectedFiles.value = selectedFiles.value.filter((_, i) => i !== index);
}

function handleDrop(e: DragEvent) {
  dragOver.value = false;
  if (e.dataTransfer?.files.length) {
    addFiles(e.dataTransfer.files);
  }
}

function handleFileInput(e: Event) {
  const input = e.target as HTMLInputElement;
  if (input.files?.length) {
    addFiles(input.files);
    input.value = "";
  }
}

const canImport = computed(() => selectedFiles.value.length > 0 && phase.value !== "importing");

async function handleImport() {
  if (!canImport.value) return;
  phase.value = "importing";
  errorMessage.value = "";
  resultMessage.value = "";

  try {
    const result = await kbFileStore.importFiles(props.kbId, selectedFiles.value);
    const importedCount = result.imported.length;
    const errorCount = result.errors.length;

    if (errorCount === 0) {
      resultMessage.value = `成功导入 ${importedCount} 个文件`;
    } else {
      resultMessage.value = `导入 ${importedCount} 个文件，${errorCount} 个失败`;
      errorMessage.value = result.errors.map((e) => `${e.name}: ${e.error}`).join("\n");
    }
    phase.value = "done";
  } catch (e: any) {
    errorMessage.value = e?.message ?? "导入失败";
    phase.value = "idle";
  }
}

function handleClose() {
  if (phase.value === "importing") return;
  selectedFiles.value = [];
  phase.value = "idle";
  resultMessage.value = "";
  errorMessage.value = "";
  emit("close");
}

function handleDone() {
  selectedFiles.value = [];
  phase.value = "idle";
  resultMessage.value = "";
  errorMessage.value = "";
  emit("done");
}

watch(
  () => props.show,
  (visible) => {
    if (!visible) {
      selectedFiles.value = [];
      phase.value = "idle";
      resultMessage.value = "";
      errorMessage.value = "";
    }
  },
);
</script>

<template>
  <NModal :show="show" @update:show="(v: boolean) => { if (!v) handleClose(); }">
    <div class="dialog" @click.stop>
      <div class="dialog-header">
        <h3 class="dialog-title">{{ t('kb.file.import') }}</h3>
        <button class="dialog-close" @click="handleClose" :disabled="phase === 'importing'">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
          </svg>
        </button>
      </div>

      <div class="dialog-body">
        <!-- Drop zone -->
        <div
          class="drop-zone"
          :class="{ 'drag-over': dragOver, 'has-files': selectedFiles.length > 0 }"
          @dragover.prevent="dragOver = true"
          @dragleave.prevent="dragOver = false"
          @drop.prevent="handleDrop"
        >
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none" class="drop-icon">
            <path d="M16 6v14M10 12l6-6 6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
            <path d="M6 22v2a2 2 0 002 2h16a2 2 0 002-2v-2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
          </svg>
          <p class="drop-hint">拖拽文件到此处，或点击选择</p>
          <p class="drop-sub">支持 .txt .md .pdf .docx（单文件 ≤ 50MB，最多 {{ MAX_FILES }} 个）</p>
          <input
            type="file"
            multiple
            accept=".txt,.md,.pdf,.docx"
            class="file-input"
            @change="handleFileInput"
          />
        </div>

        <!-- File list -->
        <div v-if="selectedFiles.length" class="file-list">
          <div v-for="(file, i) in selectedFiles" :key="i" class="file-item">
            <span class="file-item-name">{{ file.name }}</span>
            <span class="file-item-size">{{ formatSize(file.size) }}</span>
            <span class="ext-badge">.{{ getExt(file.name) }}</span>
            <button
              class="file-remove"
              @click="removeFile(i)"
              :disabled="phase === 'importing'"
              title="移除"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
              </svg>
            </button>
          </div>
        </div>

        <!-- Result / Error -->
        <div v-if="resultMessage" class="result-block" :class="{ error: errorMessage }">
          {{ resultMessage }}
        </div>
        <pre v-if="errorMessage" class="error-detail">{{ errorMessage }}</pre>
      </div>

      <div class="dialog-actions">
        <template v-if="phase === 'done'">
          <button class="btn-save" @click="handleDone">完成</button>
        </template>
        <template v-else>
          <button class="btn-cancel" @click="handleClose" :disabled="phase === 'importing'">
            {{ t('model.cancel') }}
          </button>
          <button class="btn-save" :disabled="!canImport" @click="handleImport">
            <span v-if="phase === 'importing'" class="btn-spinner" />
            {{ phase === 'importing' ? t('skillStore.installing') : t('kb.file.import') }}
          </button>
        </template>
      </div>
    </div>
  </NModal>
</template>

<style scoped>
.dialog {
  width: 520px;
  max-width: 90vw;
  display: flex;
  flex-direction: column;
  background: var(--bg-deep);
  border: 1px solid var(--border-default);
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}
.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 12px;
}
.dialog-title {
  font-family: var(--font-mono);
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}
.dialog-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
}
.dialog-close:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.dialog-close:disabled { opacity: 0.4; cursor: not-allowed; }

.dialog-body {
  padding: 4px 20px 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* Drop zone */
.drop-zone {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 28px 16px;
  border: 2px dashed var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  cursor: pointer;
  transition: all var(--transition-fast);
}
.drop-zone:hover,
.drop-zone.drag-over {
  border-color: var(--accent);
  background: var(--bg-elevated);
}
.drop-zone.has-files {
  padding: 16px;
}
.drop-icon {
  color: var(--text-muted);
  opacity: 0.5;
}
.drop-hint {
  margin: 0;
  font-size: 13px;
  color: var(--text-secondary);
}
.drop-sub {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
}
.file-input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

/* File list */
.file-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 200px;
  overflow-y: auto;
}
.file-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
  font-size: 12px;
}
.file-item-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
  font-family: var(--font-mono);
}
.file-item-size {
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 11px;
  flex-shrink: 0;
}
.ext-badge {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  color: var(--text-secondary);
  flex-shrink: 0;
}
.file-remove {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  flex-shrink: 0;
  transition: all var(--transition-fast);
}
.file-remove:hover:not(:disabled) {
  color: var(--rose);
  background: rgba(244, 63, 94, 0.1);
}
.file-remove:disabled { opacity: 0.4; cursor: not-allowed; }

.result-block {
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  background: var(--accent-dim);
  color: var(--accent);
  font-size: 12px;
}
.result-block.error {
  background: var(--amber-dim, rgba(229, 168, 18, 0.15));
  color: var(--amber);
}
.error-detail {
  margin: 0;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  background: var(--rose-dim);
  color: var(--rose);
  font-size: 11px;
  line-height: 1.5;
  white-space: pre-wrap;
  max-height: 120px;
  overflow-y: auto;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 8px 20px 16px;
}
.btn-cancel, .btn-save {
  padding: 7px 18px;
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--transition-fast);
}
.btn-cancel {
  border: 1px solid var(--border-default);
  background: transparent;
  color: var(--text-muted);
}
.btn-cancel:hover:not(:disabled) {
  border-color: var(--text-muted);
  color: var(--text-primary);
}
.btn-cancel:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-save {
  border: none;
  background: var(--accent);
  color: var(--bg-void);
}
.btn-save:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-save:not(:disabled):hover { filter: brightness(1.1); }
.btn-spinner {
  width: 12px;
  height: 12px;
  border: 1.5px solid rgba(0, 0, 0, 0.3);
  border-top-color: var(--bg-void);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  display: inline-block;
  margin-right: 6px;
  vertical-align: -2px;
}
@keyframes spin { to { transform: rotate(360deg); } }
</style>
