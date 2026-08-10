<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { NInput, NSwitch, NSelect } from "naive-ui";
import { useKbStore } from "../stores/kb.js";
import { useAgentStore } from "../stores/agent.js";
import { useI18n } from "../i18n/index.js";
import ConfirmDialog from "./ConfirmDialog.vue";

const props = defineProps<{ kbId: string }>();
const emit = defineEmits<{
  (e: "deleted"): void;
}>();

const kbStore = useKbStore();
const agentStore = useAgentStore();
const { t } = useI18n();

const name = ref("");
const description = ref("");
const enabled = ref(true);
const embeddingModelId = ref<string | null>(null);
const saving = ref(false);
const error = ref("");
const showDeleteConfirm = ref(false);

const kb = computed(() => kbStore.current);

const embeddingModelOptions = computed(() =>
  agentStore.modelDtos
    .filter((m) => m.modelType === "embedding")
    .map((m) => ({ label: m.label, value: m.id })),
);

watch(
  () => kb.value,
  (k) => {
    if (k) {
      name.value = k.name;
      description.value = k.description ?? "";
      enabled.value = k.enabled;
      embeddingModelId.value = k.embeddingModelId ?? null;
    }
  },
  { immediate: true },
);

const hasChanges = computed(() => {
  if (!kb.value) return false;
  return (
    name.value.trim() !== kb.value.name ||
    description.value.trim() !== (kb.value.description ?? "") ||
    enabled.value !== kb.value.enabled ||
    embeddingModelId.value !== (kb.value.embeddingModelId ?? null)
  );
});

const canSave = computed(() => {
  return hasChanges.value && !saving.value && name.value.trim().length > 0 && name.value.trim().length <= 100;
});

async function handleSave() {
  if (!canSave.value) return;
  saving.value = true;
  error.value = "";

  try {
    const patch: { name?: string; description?: string | null; enabled?: boolean; embeddingModelId?: string | null } = {};
    if (name.value.trim() !== kb.value?.name) patch.name = name.value.trim();
    if (description.value.trim() !== (kb.value?.description ?? "")) {
      patch.description = description.value.trim() || null;
    }
    if (enabled.value !== kb.value?.enabled) patch.enabled = enabled.value;
    if (embeddingModelId.value !== (kb.value?.embeddingModelId ?? null)) {
      patch.embeddingModelId = embeddingModelId.value;
    }

    await kbStore.update(props.kbId, patch);
  } catch (e: any) {
    error.value = e?.message ?? t("kb.settings.saveError");
  } finally {
    saving.value = false;
  }
}

async function handleDelete() {
  showDeleteConfirm.value = false;
  try {
    await kbStore.remove(props.kbId);
    emit("deleted");
  } catch (e: any) {
    console.error("Failed to delete KB:", e);
  }
}
</script>

<template>
  <div class="kb-settings-tab">
    <div class="settings-body">
      <!-- Name -->
      <label class="field">
        <span class="label">{{ t('kb.name') }}</span>
        <NInput
          v-model:value="name"
          size="small"
          :placeholder="t('kb.namePlaceholder')"
          maxlength="100"
          show-count
          :disabled="saving"
        />
      </label>

      <!-- Description -->
      <label class="field">
        <span class="label">{{ t('kb.description') }}</span>
        <NInput
          v-model:value="description"
          type="textarea"
          size="small"
          :placeholder="t('kb.descriptionPlaceholder')"
          maxlength="500"
          show-count
          :autosize="{ minRows: 3, maxRows: 6 }"
          :disabled="saving"
        />
      </label>

      <!-- Enabled toggle -->
      <div class="field-row">
        <div class="field-text">
          <span class="field-label">{{ t('kb.enabled') }}</span>
          <span class="field-hint">{{ enabled ? t('kb.settings.enabledHint') : t('kb.settings.disabledHint') }}</span>
        </div>
        <NSwitch v-model:value="enabled" :disabled="saving" />
      </div>

      <!-- Embedding Model -->
      <label class="field">
        <span class="label">{{ t('kb.embeddingModel') }}</span>
        <NSelect
          v-model:value="embeddingModelId"
          size="small"
          :options="embeddingModelOptions"
          :placeholder="embeddingModelOptions.length ? t('kb.embeddingModelPlaceholder') : t('kb.noEmbeddingModel')"
          clearable
          :disabled="saving || !embeddingModelOptions.length"
        />
        <span class="field-hint">{{ t('kb.embeddingModelHint') }}</span>
      </label>

      <!-- Error -->
      <div v-if="error" class="error-block">{{ error }}</div>

      <!-- Save -->
      <div class="settings-actions">
        <button class="btn-save" :disabled="!canSave" @click="handleSave">
          <span v-if="saving" class="btn-spinner" />
          {{ t('model.save') }}
        </button>
      </div>

      <!-- Danger zone -->
      <div class="danger-zone">
        <h4 class="danger-title">{{ t('kb.settings.dangerTitle') }}</h4>
        <p class="danger-desc">{{ t('kb.settings.dangerDesc') }}</p>
        <button class="btn-danger" @click="showDeleteConfirm = true">
          {{ t('kb.delete') }}
        </button>
      </div>
    </div>

    <ConfirmDialog
      :show="showDeleteConfirm"
      :title="t('kb.delete')"
      :message="t('kb.deleteConfirm', { name: kb?.name ?? '' })"
      :confirm-label="t('kb.delete')"
      :cancel-label="t('model.cancel')"
      :danger="true"
      @close="showDeleteConfirm = false"
      @confirm="handleDelete"
    />
  </div>
</template>

<style scoped>
.kb-settings-tab {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  height: 100%;
}

.settings-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px 28px 24px;
  max-width: 560px;
  overflow-y: auto;
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
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.field-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 0;
  border-top: 1px solid var(--border-subtle);
}
.field-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.field-label {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}
.field-hint {
  font-size: 11px;
  color: var(--text-muted);
}

.error-block {
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  background: var(--rose-dim);
  color: var(--rose);
  font-size: 12px;
}

.settings-actions {
  display: flex;
  gap: 8px;
  padding-top: 4px;
}
.btn-save {
  padding: 7px 18px;
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--transition-fast);
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

/* Danger zone */
.danger-zone {
  margin-top: 16px;
  padding: 16px;
  border: 1px solid var(--rose);
  border-radius: var(--radius-md);
  background: var(--rose-dim, rgba(244, 63, 94, 0.06));
}
.danger-title {
  margin: 0 0 6px;
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
  color: var(--rose);
}
.danger-desc {
  margin: 0 0 12px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary);
}
.btn-danger {
  padding: 7px 18px;
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid var(--rose);
  background: transparent;
  color: var(--rose);
  transition: all var(--transition-fast);
}
.btn-danger:hover {
  background: var(--rose);
  color: #fff;
}
</style>
