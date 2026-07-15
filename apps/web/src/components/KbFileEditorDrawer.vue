<script setup lang="ts">
import { ref, watch, computed, nextTick } from "vue";
import { NDrawer, NDrawerContent, NInput, NSpin } from "naive-ui";
import { api } from "../api/client.js";
import type { KbFileDto } from "@pi-web-ui/shared";

const props = defineProps<{
  show: boolean;
  fileId: string | null;
  kbId?: string;
  isNew?: boolean;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "saved"): void;
}>();

const file = ref<KbFileDto | null>(null);
const name = ref("");
const content = ref("");
const loading = ref(false);
const saving = ref(false);
const error = ref("");
const nameInput = ref<InstanceType<typeof NInput> | null>(null);

const isNewMode = computed(() => props.isNew === true && !props.fileId);

const canSave = computed(() => {
  if (saving.value || loading.value) return false;
  if (!name.value.trim().length) return false;
  if (isNewMode.value) return content.value.trim().length > 0;
  return name.value.trim() !== file.value?.name || content.value !== originalContent.value;
});

function inferExt(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot > 0) return filename.slice(dot + 1).toLowerCase();
  return "txt";
}

const originalContent = ref("");

async function loadFile(id: string) {
  loading.value = true;
  error.value = "";
  file.value = null;
  name.value = "";
  content.value = "";
  originalContent.value = "";

  try {
    const [fileData, contentData] = await Promise.all([
      api.getKbFile(id),
      api.getKbFileContent(id),
    ]);
    file.value = fileData;
    name.value = fileData.name;
    content.value = contentData.content;
    originalContent.value = contentData.content;
    nextTick(() => nameInput.value?.focus());
  } catch (e: any) {
    error.value = e?.message ?? "加载文件失败";
  } finally {
    loading.value = false;
  }
}

async function handleSave() {
  if (!canSave.value) return;
  saving.value = true;
  error.value = "";

  try {
    if (isNewMode.value && props.kbId) {
      const rawName = name.value.trim();
      const ext = inferExt(rawName);
      const baseName = ext !== "txt" && rawName.endsWith(`.${ext}`) ? rawName.slice(0, -(ext.length + 1)) : rawName;
      await api.createKbFile(props.kbId, baseName, ext, content.value);
    } else if (props.fileId) {
      const patch: { name?: string; content?: string } = {};
      if (name.value.trim() !== file.value?.name) {
        patch.name = name.value.trim();
      }
      if (content.value !== originalContent.value) {
        patch.content = content.value;
      }
      await api.updateKbFile(props.fileId, patch);
      originalContent.value = content.value;
      if (patch.name && file.value) {
        file.value.name = patch.name;
      }
    }
    emit("saved");
  } catch (e: any) {
    error.value = e?.message ?? "保存失败";
  } finally {
    saving.value = false;
  }
}

watch(
  () => [props.show, props.fileId, props.isNew] as const,
  ([visible, id, isNewFlag]) => {
    if (visible && id && !isNewFlag) {
      loadFile(id);
    } else if (visible && isNewFlag) {
      file.value = null;
      name.value = "";
      content.value = "";
      originalContent.value = "";
      error.value = "";
      nextTick(() => nameInput.value?.focus());
    } else {
      file.value = null;
      name.value = "";
      content.value = "";
      originalContent.value = "";
      error.value = "";
    }
  },
  { immediate: true },
);
</script>

<template>
  <NDrawer
    :show="show"
    placement="right"
    @update:show="(v: boolean) => { if (!v) emit('close'); }"
  >
    <NDrawerContent :width="560" closable>
      <template #header>
        <span class="drawer-title">{{ isNewMode ? '新建文件' : '编辑文件' }}</span>
      </template>

      <!-- Loading state -->
      <div v-if="loading" class="loading-container">
        <NSpin size="medium" />
      </div>

      <!-- Error state (initial load) -->
      <div v-else-if="error && !file" class="error-container">
        <div class="error-block">{{ error }}</div>
      </div>

      <!-- Editor form (also shown in new mode when file is null) -->
      <div v-else-if="file || isNewMode" class="editor-body">
        <label class="field">
          <span class="label">文件名</span>
          <NInput
            ref="nameInput"
            v-model:value="name"
            size="small"
            placeholder="输入文件名"
            :disabled="saving"
          />
        </label>

        <label class="field field-content">
          <span class="label">内容</span>
          <NInput
            v-model:value="content"
            type="textarea"
            :autosize="{ minRows: 18 }"
            placeholder="文件内容"
            :disabled="saving"
            class="content-textarea"
          />
        </label>

        <div v-if="error && file" class="error-block">{{ error }}</div>

        <div class="editor-actions">
          <button class="btn-cancel" @click="emit('close')" :disabled="saving">
            取消
          </button>
          <button class="btn-save" :disabled="!canSave" @click="handleSave">
            <span v-if="saving" class="btn-spinner" />
            保存
          </button>
        </div>
      </div>
    </NDrawerContent>
  </NDrawer>
</template>

<style scoped>
.drawer-title {
  font-family: var(--font-mono);
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
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

.editor-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: 100%;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.field-content {
  flex: 1;
  min-height: 0;
}
.label {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.content-textarea {
  flex: 1;
}

.error-block {
  padding: 8px 10px;
  border-radius: var(--radius-md);
  background: var(--rose-dim);
  color: var(--rose);
  font-size: 12px;
  line-height: 1.5;
}

.editor-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 8px;
  flex-shrink: 0;
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
@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
