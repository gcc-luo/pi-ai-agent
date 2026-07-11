<script setup lang="ts">
import { ref, computed, watch, nextTick } from "vue";
import { NModal } from "naive-ui";
import { useI18n } from "../i18n/index.js";
import { useSkillStore } from "../stores/skill.js";

const props = defineProps<{ show: boolean }>();
const emit = defineEmits<{ (e: "close"): void }>();

const { t } = useI18n();
const skillStore = useSkillStore();

const file = ref<File | null>(null);
const phase = ref<"idle" | "uploading" | "success" | "error">("idle");
const errorMessage = ref("");
const successMessage = ref("");
const partialErrors = ref<string[]>([]);
const fileInput = ref<HTMLInputElement | null>(null);
const dragOver = ref(false);

const canImport = computed(() => !!file.value && phase.value !== "uploading" && phase.value !== "success");

watch(
  () => props.show,
  (visible) => {
    if (!visible) return;
    file.value = null;
    phase.value = "idle";
    errorMessage.value = "";
    successMessage.value = "";
    partialErrors.value = [];
  },
  { immediate: true },
);

function pickFile() {
  fileInput.value?.click();
}

function onFileChosen(e: Event) {
  const target = e.target as HTMLInputElement;
  const f = target.files?.[0];
  if (!f) return;
  attachFile(f);
  target.value = "";
}

function onDrop(e: DragEvent) {
  dragOver.value = false;
  if (e.dataTransfer?.files?.length) {
    attachFile(e.dataTransfer.files[0]!);
  }
}

function attachFile(f: File) {
  if (!f.name.toLowerCase().endsWith(".zip")) {
    file.value = null;
    phase.value = "error";
    errorMessage.value = t("skill.zipOnly");
    return;
  }
  file.value = f;
  phase.value = "idle";
  errorMessage.value = "";
  partialErrors.value = [];
}

function friendlyError(code: string): string {
  const key = `skill.err.${code}`;
  const localized = t(key);
  return localized === key ? t("skill.err.unknown") : localized;
}

async function handleImport() {
  if (!file.value) return;
  phase.value = "uploading";
  errorMessage.value = "";
  partialErrors.value = [];
  try {
    const result = await skillStore.importSkillZip(file.value);
    const names = result.imported.map((s) => s.name);
    if (result.imported.length === 1) {
      successMessage.value = t("skill.zipSuccess").replace("{name}", names[0] ?? "");
    } else {
      successMessage.value = t("skill.zipSuccessMulti")
        .replace("{count}", String(result.imported.length))
        .replace("{names}", names.join(", "));
    }
    if (result.errors.length) {
      partialErrors.value = result.errors;
    }
    phase.value = "success";
    // Auto-close shortly after a successful import so the user sees the toast.
    setTimeout(() => {
      if (phase.value === "success") emit("close");
    }, 1800);
  } catch (e: any) {
    const code = typeof e?.message === "string" ? e.message : "";
    errorMessage.value = friendlyError(code);
    phase.value = "error";
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === "Enter" && canImport.value) {
    e.preventDefault();
    handleImport();
  }
}

// Auto-focus the file picker when the dialog opens.
watch(
  () => props.show,
  (visible) => {
    if (!visible) return;
    nextTick(() => fileInput.value?.focus());
  },
);
</script>

<template>
  <NModal :show="show" @update:show="(v: boolean) => { if (!v) emit('close'); }">
    <div class="dialog" @click.stop @keydown="handleKeydown">
      <div class="dialog-header">
        <h3 class="dialog-title">{{ t('skill.zipTitle') }}</h3>
        <button class="dialog-close" @click="emit('close')" :disabled="phase === 'uploading'">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
          </svg>
        </button>
      </div>

      <div class="dialog-body">
        <input
          ref="fileInput"
          type="file"
          accept=".zip,application/zip,application/x-zip-compressed"
          class="file-input-hidden"
          @change="onFileChosen"
        />
        <div
          class="dropzone"
          :class="{ 'drag-over': dragOver, hasFile: !!file, error: phase === 'error' && !file, success: phase === 'success' }"
          @click="pickFile"
          @dragover.prevent="dragOver = true"
          @dragleave.prevent="dragOver = false"
          @drop.prevent="onDrop"
        >
          <template v-if="phase === 'uploading'">
            <div class="spinner" aria-hidden="true" />
            <div class="dropzone-text">{{ t('skill.zipValidating') }}</div>
          </template>
          <template v-else-if="phase === 'success'">
            <svg class="status-icon ok" width="22" height="22" viewBox="0 0 22 22" fill="none">
              <circle cx="11" cy="11" r="9" stroke="currentColor" stroke-width="1.4" />
              <path d="M7 11l3 3 5-6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            <div class="dropzone-text success-text">{{ successMessage }}</div>
          </template>
          <template v-else-if="file">
            <svg class="status-icon" width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M5 2.5h7.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V17a1 1 0 01-1 1H5a1 1 0 01-1-1V3.5a1 1 0 011-1z" stroke="currentColor" stroke-width="1.2" />
              <path d="M12 2.5V6h3.5" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" />
            </svg>
            <div class="dropzone-text">{{ t('skill.zipSelected').replace('{name}', file.name) }}</div>
            <button class="link-btn" @click.stop="pickFile">{{ t('skill.zipChange') }}</button>
          </template>
          <template v-else>
            <svg class="status-icon" width="22" height="22" viewBox="0 0 22 22" fill="none">
              <path d="M11 3v10M7 9l4 4 4-4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
              <path d="M4 17h14" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
            </svg>
            <div class="dropzone-text">{{ t('skill.zipDropHint') }}</div>
            <button class="link-btn" @click.stop="pickFile">{{ t('skill.zipChoose') }}</button>
          </template>
        </div>

        <div v-if="phase === 'error' && errorMessage" class="status-block error">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="6" stroke="currentColor" stroke-width="1.3" />
            <path d="M7 4v3.5M7 9.5v.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
          </svg>
          <span>{{ errorMessage }}</span>
        </div>

        <div v-if="phase === 'success' && partialErrors.length" class="status-block warn">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 1.5l6 10H1z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" />
            <path d="M7 6v3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
            <circle cx="7" cy="10" r="0.6" fill="currentColor" />
          </svg>
          <span>{{ t('skill.zipPartialFail').replace('{errors}', partialErrors.join('; ')) }}</span>
        </div>
      </div>

      <div class="dialog-actions">
        <button class="btn-cancel" @click="emit('close')" :disabled="phase === 'uploading'">
          {{ t('skill.cancel') }}
        </button>
        <button
          class="btn-save"
          data-test="import"
          :disabled="!canImport"
          @click="handleImport"
        >
          <span v-if="phase === 'uploading'" class="btn-spinner" />
          {{ phase === 'uploading' ? t('skill.zipImporting') : t('skill.zipImport') }}
        </button>
      </div>
    </div>
  </NModal>
</template>

<style scoped>
.dialog {
  width: 480px;
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
.dialog-close:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.dialog-body {
  padding: 4px 20px 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.file-input-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.dropzone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 28px 16px;
  border: 1.5px dashed var(--border-active);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);
  min-height: 120px;
  text-align: center;
}
.dropzone:hover {
  border-color: var(--accent);
  color: var(--text-primary);
  background: var(--accent-dim);
}
.dropzone.drag-over {
  border-color: var(--accent);
  background: var(--accent-dim);
}
.dropzone.hasFile {
  border-style: solid;
  border-color: var(--accent);
  color: var(--text-primary);
}
.dropzone.error {
  border-color: var(--rose);
  color: var(--rose);
}
.dropzone.success {
  border-color: var(--green);
  color: var(--green);
  background: var(--green-dim);
}

.dropzone-text {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
}
.dropzone.success .dropzone-text,
.dropzone.success .status-icon {
  color: var(--green);
}
.success-text {
  font-weight: 600;
  color: var(--green);
  font-size: 13px;
}

.status-icon {
  color: var(--text-muted);
  flex-shrink: 0;
}
.status-icon.ok {
  color: var(--green);
}

.link-btn {
  background: transparent;
  border: none;
  color: var(--accent);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
}
.link-btn:hover {
  text-decoration: underline;
}

.spinner,
.btn-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--border-active);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  display: inline-block;
}
.btn-spinner {
  width: 12px;
  height: 12px;
  border-width: 1.5px;
  margin-right: 6px;
  vertical-align: -2px;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}

.status-block {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  line-height: 1.5;
}
.status-block.error {
  background: var(--rose-dim);
  color: var(--rose);
}
.status-block.warn {
  background: var(--amber-dim);
  color: var(--amber);
}
.status-block svg {
  flex-shrink: 0;
  margin-top: 1px;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 8px 20px 16px;
}
.btn-cancel,
.btn-save {
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
.btn-cancel:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.btn-save {
  border: none;
  background: var(--accent);
  color: var(--bg-void);
}
.btn-save:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.btn-save:not(:disabled):hover {
  filter: brightness(1.1);
}
</style>
