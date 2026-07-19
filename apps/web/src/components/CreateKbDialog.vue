<script setup lang="ts">
import { ref, computed, watch, nextTick } from "vue";
import { NModal, NInput } from "naive-ui";
import { useKbStore } from "../stores/kb.js";
import { useI18n } from "../i18n/index.js";
import type { KbDto } from "@pi-web-ui/shared";

const props = defineProps<{
  show: boolean;
  editKb?: KbDto;
}>();
const emit = defineEmits<{
  (e: "close"): void;
  (e: "saved"): void;
}>();

const kbStore = useKbStore();
const { t } = useI18n();

const name = ref("");
const description = ref("");
const phase = ref<"idle" | "saving" | "error">("idle");
const errorMessage = ref("");
const nameInput = ref<InstanceType<typeof NInput> | null>(null);

const isEdit = computed(() => !!props.editKb);
const nameValid = computed(() => {
  const v = name.value.trim();
  return v.length > 0 && v.length <= 100;
});
const canSave = computed(
  () => nameValid.value && phase.value !== "saving",
);

watch(
  () => props.show,
  (visible) => {
    if (!visible) return;
    if (props.editKb) {
      name.value = props.editKb.name;
      description.value = props.editKb.description ?? "";
    } else {
      name.value = "";
      description.value = "";
    }
    phase.value = "idle";
    errorMessage.value = "";
    nextTick(() => nameInput.value?.focus());
  },
  { immediate: true },
);

async function handleSave() {
  if (!canSave.value) return;
  phase.value = "saving";
  errorMessage.value = "";
  try {
    if (isEdit.value && props.editKb) {
      await kbStore.update(props.editKb.id, {
        name: name.value.trim(),
        description: description.value.trim() || null,
      });
    } else {
      await kbStore.create(
        name.value.trim(),
        description.value.trim() || undefined,
      );
    }
    emit("saved");
    emit("close");
  } catch (e: any) {
    const msg = e?.message ?? t("kb.create.errorDefault");
    if (msg.includes("duplicate") || msg.includes("conflict") || msg.includes("already exists")) {
      errorMessage.value = t("kb.create.errorNameExists", { name: name.value.trim() });
    } else {
      errorMessage.value = msg;
    }
    phase.value = "error";
  }
}
</script>

<template>
  <NModal :show="show" @update:show="(v: boolean) => { if (!v) emit('close'); }">
    <div class="dialog" @click.stop>
      <div class="dialog-header">
        <h3 class="dialog-title">{{ isEdit ? t('kb.create.editTitle') : t('kb.create.newTitle') }}</h3>
        <button class="dialog-close" @click="emit('close')" :disabled="phase === 'saving'">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
          </svg>
        </button>
      </div>

      <div class="dialog-body">
        <label class="field">
          <span class="label">{{ t('kb.create.nameLabel') }} <span class="required">*</span></span>
          <NInput
            ref="nameInput"
            v-model:value="name"
            size="small"
            :placeholder="t('kb.create.namePlaceholder')"
            maxlength="100"
            show-count
            :status="name && !nameValid ? 'error' : undefined"
            @keydown.enter="handleSave"
          />
        </label>
        <label class="field">
          <span class="label">{{ t('kb.create.descriptionLabel') }}</span>
          <NInput
            v-model:value="description"
            type="textarea"
            size="small"
            :placeholder="t('kb.create.descriptionPlaceholder')"
            maxlength="500"
            show-count
            :autosize="{ minRows: 3, maxRows: 6 }"
          />
        </label>
        <div v-if="phase === 'error' && errorMessage" class="error-block">
          {{ errorMessage }}
        </div>
      </div>

      <div class="dialog-actions">
        <button class="btn-cancel" @click="emit('close')" :disabled="phase === 'saving'">
          {{ t('kb.create.cancel') }}
        </button>
        <button class="btn-save" :disabled="!canSave" @click="handleSave">
          <span v-if="phase === 'saving'" class="btn-spinner" />
          {{ isEdit ? t('kb.create.save') : t('kb.create.create') }}
        </button>
      </div>
    </div>
  </NModal>
</template>

<style scoped>
.dialog {
  width: 480px;
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
  gap: 14px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.label {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  color: var(--text-faint);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.required {
  color: var(--rose);
}
.error-block {
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  background: var(--rose-dim);
  color: var(--rose);
  font-size: 12px;
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
