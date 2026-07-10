<script setup lang="ts">
import { ref, computed, watch, nextTick } from "vue";
import { NModal, NInput } from "naive-ui";
import { useI18n } from "../i18n/index.js";

const props = defineProps<{ show: boolean }>();
const emit = defineEmits<{
  (e: "close"): void;
  (e: "create", data: { name: string; description: string; body: string }): void;
}>();

const { t } = useI18n();
const name = ref("");
const description = ref("");
const body = ref("");

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const nameValid = computed(() => NAME_RE.test(name.value.trim()) && name.value.trim().length <= 64);
const descriptionValid = computed(() => description.value.trim().length > 0 && description.value.trim().length <= 1024);
const bodyValid = computed(() => body.value.trim().length > 0);
const canSave = computed(() => nameValid.value && descriptionValid.value && bodyValid.value);

watch(
  () => props.show,
  (visible) => {
    if (!visible) return;
    name.value = "";
    description.value = "";
    body.value = "";
  },
  { immediate: true },
);

function handleSave() {
  if (!canSave.value) return;
  emit("create", { name: name.value.trim(), description: description.value.trim(), body: body.value });
  emit("close");
}
</script>

<template>
  <NModal :show="show" @update:show="(v: boolean) => { if (!v) emit('close'); }">
    <div class="dialog" @click.stop>
      <div class="dialog-header">
        <h3 class="dialog-title">{{ t('skill.title') }}</h3>
        <button class="dialog-close" @click="emit('close')">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
          </svg>
        </button>
      </div>

      <div class="field-row">
        <label class="field-label">{{ t('skill.name') }}</label>
        <NInput
          v-model:value="name"
          size="small"
          :placeholder="t('skill.namePlaceholder')"
        />
      </div>
      <div v-if="name && !nameValid" class="field-hint">{{ t('skill.nameHint') }}</div>

      <div class="field-row">
        <label class="field-label">{{ t('skill.description') }}</label>
        <NInput
          v-model:value="description"
          size="small"
          :placeholder="t('skill.descriptionPlaceholder')"
        />
      </div>

      <div class="field-row">
        <label class="field-label">{{ t('skill.body') }}</label>
        <NInput
          v-model:value="body"
          type="textarea"
          :rows="6"
          :autosize="{ minRows: 4, maxRows: 12 }"
          :placeholder="t('skill.bodyPlaceholder')"
        />
      </div>

      <div class="dialog-actions">
        <button class="btn-cancel" @click="emit('close')">{{ t('skill.cancel') }}</button>
        <button
          class="btn-save"
          data-test="save"
          :disabled="!canSave"
          @click="handleSave"
        >
          {{ t('skill.save') }}
        </button>
      </div>
    </div>
  </NModal>
</template>

<style scoped>
.dialog {
  width: 520px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-deep);
  border: 1px solid var(--border-default);
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  overflow-y: auto;
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
.dialog-close:hover { background: var(--bg-hover); color: var(--text-primary); }
.field-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 20px 0;
}
.field-label {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  color: var(--text-faint);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.field-hint {
  padding: 0 20px 4px;
  font-size: 11px;
  color: var(--amber);
}
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 16px 20px;
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
.btn-cancel:hover { border-color: var(--text-muted); color: var(--text-primary); }
.btn-save {
  border: none;
  background: var(--accent);
  color: var(--bg-void);
}
.btn-save:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-save:not(:disabled):hover { filter: brightness(1.1); }
</style>
