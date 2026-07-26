<script setup lang="ts">
import { computed, ref, watch, nextTick } from "vue";
import { NModal, NInput, NSelect, NSwitch, useMessage } from "naive-ui";
import type { ChannelConfigDto, ChannelConfigField, ChannelDescriptor, ProjectDto } from "@pi-web-ui/shared";
import { useChannelStore } from "../stores/channel.js";
import { useI18n } from "../i18n/index.js";
import { api } from "../api/client.js";

const props = defineProps<{
  show: boolean;
  descriptor: ChannelDescriptor | null;
  existing: ChannelConfigDto | null;
}>();
const emit = defineEmits<{
  (e: "update:show", v: boolean): void;
  (e: "saved"): void;
}>();

const store = useChannelStore();
const { t } = useI18n();
const message = useMessage();

const name = ref("");
const formValues = ref<Record<string, string | boolean>>({});
const phase = ref<"idle" | "saving" | "error">("idle");
const errorMessage = ref("");
const nameInput = ref<InstanceType<typeof NInput> | null>(null);
const projects = ref<ProjectDto[]>([]);
const projectOptions = computed(() => projects.value.map((project) => ({ label: project.name, value: project.id })));

const isEdit = computed(() => !!props.existing);

function fieldPlaceholder(field: ChannelConfigField): string | undefined {
  if (field.kind === "boolean") return undefined;
  if (field.secret && isEdit.value && props.existing) {
    return t("channel.secretKeepPlaceholder");
  }
  const key = `channel.${props.descriptor?.type}.field.${field.key}.placeholder`;
  const translated = t(key);
  return translated === key ? field.placeholder : translated;
}

function fieldLabel(field: ChannelConfigField): string {
  const key = `channel.${props.descriptor?.type}.field.${field.key}`;
  const translated = t(key);
  return translated === key ? field.label : translated;
}

const descriptorLabel = computed(() => {
  if (!props.descriptor) return "";
  return t(`channel.${props.descriptor.type}.label`);
});

function initialValue(field: ChannelConfigField): string | boolean {
  if (field.kind === "boolean") {
    return Boolean(props.existing?.config?.[field.key] ?? false);
  }
  // For secret fields on edit, leave empty so the placeholder shows.
  if (field.secret && isEdit.value) return "";
  const v = props.existing?.config?.[field.key];
  return typeof v === "string" ? v : "";
}

watch(
  () => props.show,
  (visible) => {
    if (!visible || !props.descriptor) return;
    void api.listProjects().then((items) => { projects.value = items; }).catch(() => { projects.value = []; });
    name.value = props.existing?.name ?? "";
    formValues.value = {};
    for (const field of props.descriptor.configSchema) {
      formValues.value[field.key] = initialValue(field);
    }
    phase.value = "idle";
    errorMessage.value = "";
    nextTick(() => nameInput.value?.focus());
  },
  { immediate: true },
);

function requiredMissing(): string | null {
  if (!props.descriptor) return null;
  for (const field of props.descriptor.configSchema) {
    if (field.kind === "boolean") continue;
    if (!field.required) continue;
    const v = formValues.value[field.key];
    if (typeof v !== "string" || v.trim() === "") {
      // On edit, secret fields may be left blank to keep the existing value.
      if (field.secret && isEdit.value) continue;
      return fieldLabel(field);
    }
  }
  return null;
}

const canSave = computed(() => {
  if (!props.descriptor) return false;
  if (!name.value.trim()) return false;
  if (requiredMissing()) return false;
  return phase.value !== "saving";
});

function buildConfig(): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  if (!props.descriptor) return config;
  for (const field of props.descriptor.configSchema) {
    const v = formValues.value[field.key];
    if (field.kind === "boolean") {
      config[field.key] = Boolean(v);
    } else {
      const strVal = typeof v === "string" ? v.trim() : "";
      // On edit, leave secret fields unchanged if user left blank.
      if (field.secret && isEdit.value && strVal === "") {
        const existing = props.existing?.config?.[field.key];
        if (typeof existing === "string") config[field.key] = existing;
      } else {
        config[field.key] = strVal;
      }
    }
  }
  return config;
}

async function handleSave() {
  if (!props.descriptor || !canSave.value) return;
  phase.value = "saving";
  errorMessage.value = "";
  try {
    const config = buildConfig();
    if (isEdit.value && props.existing) {
      await store.update(props.existing.id, { name: name.value.trim(), config });
    } else if (props.descriptor) {
      await store.create({
        type: props.descriptor.type,
        name: name.value.trim(),
        config,
      });
    }
    emit("saved");
    emit("update:show", false);
  } catch (e: any) {
    errorMessage.value = e?.message ?? t("channel.saveFailed");
    phase.value = "error";
    message.error(errorMessage.value);
  }
}
</script>

<template>
  <NModal :show="show" @update:show="(v: boolean) => emit('update:show', v)">
    <div class="dialog" @click.stop>
      <div class="dialog-header">
        <h3 class="dialog-title">
          {{ isEdit ? t('channel.edit') : t('channel.configure') }}
          <span class="dialog-subtitle" v-if="descriptor">{{ descriptorLabel }}</span>
        </h3>
        <button class="dialog-close" @click="emit('update:show', false)" :disabled="phase === 'saving'">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
          </svg>
        </button>
      </div>

      <div class="dialog-body">
        <label class="field">
          <span class="label">{{ t('channel.name') }} <span class="required">*</span></span>
          <NInput
            ref="nameInput"
            v-model:value="name"
            size="small"
            maxlength="50"
            :placeholder="t('channel.namePlaceholder')"
          />
        </label>

        <template v-for="field in descriptor?.configSchema ?? []" :key="field.key">
          <label v-if="field.kind === 'boolean'" class="field">
            <span class="label">{{ fieldLabel(field) }}</span>
            <NSwitch v-model:value="formValues[field.key] as boolean" />
          </label>
          <label v-else-if="field.key === 'projectId'" class="field">
            <span class="label">
              {{ fieldLabel(field) }}
              <span v-if="field.required" class="required">*</span>
            </span>
            <NSelect
              v-model:value="formValues[field.key] as string"
              size="small"
              :options="projectOptions"
              :placeholder="fieldPlaceholder(field)"
            />
          </label>
          <label v-else-if="field.kind === 'text'" class="field">
            <span class="label">
              {{ fieldLabel(field) }}
              <span v-if="field.required" class="required">*</span>
            </span>
            <NInput
              v-model:value="formValues[field.key] as string"
              type="textarea"
              size="small"
              :placeholder="fieldPlaceholder(field)"
              :autosize="{ minRows: 2, maxRows: 4 }"
            />
          </label>
          <label v-else class="field">
            <span class="label">
              {{ fieldLabel(field) }}
              <span v-if="field.required" class="required">*</span>
            </span>
            <NInput
              v-model:value="formValues[field.key] as string"
              size="small"
              :type="field.secret ? 'password' : 'text'"
              :show-password-on="field.secret ? 'click' : undefined"
              :placeholder="fieldPlaceholder(field)"
            />
          </label>
        </template>

        <div v-if="phase === 'error' && errorMessage" class="error-block">
          {{ errorMessage }}
        </div>
      </div>

      <div class="dialog-actions">
        <button class="btn-cancel" @click="emit('update:show', false)" :disabled="phase === 'saving'">
          {{ t('channel.cancel') }}
        </button>
        <button class="btn-save" :disabled="!canSave" @click="handleSave">
          <span v-if="phase === 'saving'" class="btn-spinner" />
          {{ t('channel.save') }}
        </button>
      </div>
    </div>
  </NModal>
</template>

<style scoped>
.dialog {
  width: 480px;
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
  display: flex;
  align-items: center;
  gap: 8px;
}
.dialog-subtitle {
  font-size: 12px;
  font-weight: 400;
  color: var(--text-muted);
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
