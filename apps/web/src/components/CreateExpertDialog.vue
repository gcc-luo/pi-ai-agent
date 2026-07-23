<script setup lang="ts">
import { ref, computed, watch, nextTick } from "vue";
import { NModal, NInput, NSelect, NDynamicTags } from "naive-ui";
import { useExpertStore } from "../stores/expert.js";
import { useI18n } from "../i18n/index.js";
import type { ExpertCategory, ExpertDto } from "@pi-web-ui/shared";

const props = defineProps<{
  show: boolean;
  expertId: string | null;
}>();
const emit = defineEmits<{
  (e: "close"): void;
  (e: "saved"): void;
}>();

const expertStore = useExpertStore();
const { t } = useI18n();

const name = ref("");
const icon = ref("🤖");
const category = ref<ExpertCategory>("development");
const description = ref("");
const systemPrompt = ref("");
const tags = ref<string[]>([]);
const phase = ref<"idle" | "saving" | "error">("idle");
const errorMessage = ref("");
const nameInput = ref<InstanceType<typeof NInput> | null>(null);

const isEdit = computed(() => !!props.expertId);
const editExpert = computed(() =>
  props.expertId ? expertStore.experts.find((e) => e.id === props.expertId) ?? null : null,
);

const categoryOptions = computed(() => [
  { label: t("expert.category.development"), value: "development" },
  { label: t("expert.category.design"), value: "design" },
  { label: t("expert.category.data"), value: "data" },
  { label: t("expert.category.marketing"), value: "marketing" },
  { label: t("expert.category.product"), value: "product" },
  { label: t("expert.category.finance"), value: "finance" },
  { label: t("expert.category.legal"), value: "legal" },
  { label: t("expert.category.operations"), value: "operations" },
]);

const nameValid = computed(() => name.value.trim().length > 0);
const descValid = computed(() => description.value.trim().length > 0);
const promptValid = computed(() => systemPrompt.value.trim().length > 0);
const canSave = computed(
  () => nameValid.value && descValid.value && promptValid.value && phase.value !== "saving",
);

watch(
  () => props.show,
  (visible) => {
    if (!visible) return;
    if (editExpert.value) {
      const e = editExpert.value;
      name.value = e.name;
      icon.value = e.icon;
      category.value = e.category;
      description.value = e.description;
      systemPrompt.value = e.systemPrompt;
      tags.value = [...e.tags];
    } else {
      name.value = "";
      icon.value = "🤖";
      category.value = "development";
      description.value = "";
      systemPrompt.value = "";
      tags.value = [];
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
    if (isEdit.value && props.expertId) {
      await expertStore.update(props.expertId, {
        name: name.value.trim(),
        icon: icon.value.trim() || "🤖",
        category: category.value,
        description: description.value.trim(),
        systemPrompt: systemPrompt.value.trim(),
        tags: tags.value,
      });
    } else {
      await expertStore.create({
        name: name.value.trim(),
        icon: icon.value.trim() || "🤖",
        category: category.value,
        description: description.value.trim(),
        systemPrompt: systemPrompt.value.trim(),
        tags: tags.value,
      });
    }
    emit("saved");
    emit("close");
  } catch (e: any) {
    errorMessage.value = e?.message ?? "Save failed";
    phase.value = "error";
  }
}
</script>

<template>
  <NModal :show="show" @update:show="(v: boolean) => { if (!v) emit('close'); }">
    <div class="dialog" @click.stop>
      <div class="dialog-header">
        <h3 class="dialog-title">{{ isEdit ? t('expert.editTitle') : t('expert.createTitle') }}</h3>
        <button class="dialog-close" @click="emit('close')" :disabled="phase === 'saving'">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
          </svg>
        </button>
      </div>

      <div class="dialog-body">
        <div class="field-row">
          <label class="field field-icon">
            <span class="label">{{ t('expert.icon') }}</span>
            <NInput v-model:value="icon" size="small" maxlength="4" class="icon-input" />
          </label>
          <label class="field field-name">
            <span class="label">{{ t('expert.name') }} <span class="required">*</span></span>
            <NInput
              ref="nameInput"
              v-model:value="name"
              size="small"
              maxlength="50"
              :status="name && !nameValid ? 'error' : undefined"
            />
          </label>
        </div>

        <label class="field">
          <span class="label">{{ t('expert.category') }} <span class="required">*</span></span>
          <NSelect v-model:value="category" :options="categoryOptions" size="small" />
        </label>

        <label class="field">
          <span class="label">{{ t('expert.description') }} <span class="required">*</span></span>
          <NInput
            v-model:value="description"
            type="textarea"
            size="small"
            maxlength="200"
            show-count
            :autosize="{ minRows: 2, maxRows: 4 }"
            :status="description && !descValid ? 'error' : undefined"
          />
        </label>

        <label class="field">
          <span class="label">{{ t('expert.systemPrompt') }} <span class="required">*</span></span>
          <NInput
            v-model:value="systemPrompt"
            type="textarea"
            size="small"
            maxlength="2000"
            show-count
            :autosize="{ minRows: 4, maxRows: 10 }"
            :status="systemPrompt && !promptValid ? 'error' : undefined"
          />
        </label>

        <label class="field">
          <span class="label">{{ t('expert.tags') }}</span>
          <NDynamicTags v-model:value="tags" size="small" />
        </label>

        <div v-if="phase === 'error' && errorMessage" class="error-block">
          {{ errorMessage }}
        </div>
      </div>

      <div class="dialog-actions">
        <button class="btn-cancel" @click="emit('close')" :disabled="phase === 'saving'">
          {{ t('file.deleteCancel') }}
        </button>
        <button class="btn-save" :disabled="!canSave" @click="handleSave">
          <span v-if="phase === 'saving'" class="btn-spinner" />
          {{ isEdit ? t('expert.edit') : t('expert.create') }}
        </button>
      </div>
    </div>
  </NModal>
</template>

<style scoped>
.dialog {
  width: 520px;
  max-width: 90vw;
  max-height: 85vh;
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
  flex-shrink: 0;
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
  overflow-y: auto;
  flex: 1;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.field-row {
  display: flex;
  gap: 12px;
}
.field-icon {
  width: 80px;
  flex-shrink: 0;
}
.field-name {
  flex: 1;
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
.icon-input :deep(.n-input__input) {
  text-align: center;
  font-size: 18px;
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
  flex-shrink: 0;
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
