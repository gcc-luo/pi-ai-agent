<script setup lang="ts">
import { ref, watch, computed } from "vue";
import { NModal, NInput, NButton, NSelect, NSwitch, NSpace, NTag, NTooltip } from "naive-ui";
import type { TaskType, ScheduledTaskCapabilities, ScheduledTaskDto } from "@pi-web-ui/shared";
import { useI18n } from "../i18n/index.js";
import { useProjectStore } from "../stores/project.js";
import { cronPresets, cronToHuman, validateCron, getNextRuns } from "../utils/cron-helper.js";
import CronPicker from "./CronPicker.vue";
import ChatCapabilityToolbar from "./ChatCapabilityToolbar.vue";
import ImportSkillDialog from "./ImportSkillDialog.vue";

const props = defineProps<{
  show: boolean;
  task?: ScheduledTaskDto | null;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "submit", data: {
    name: string;
    description: string;
    cronExpression: string;
    taskType: TaskType;
    payload: string;
    projectId?: string;
    createNewSession?: boolean;
    capabilities: ScheduledTaskCapabilities;
    enabled: boolean;
  }): void;
  (e: "manage-connectors"): void;
}>();

const { t } = useI18n();
const projectStore = useProjectStore();

const name = ref("");
const description = ref("");
const cronExpression = ref("0 9 * * *");
const taskType = ref<TaskType>("prompt");
const promptText = ref("");
const reminderText = ref("");
const projectId = ref<string | null>(null);
const createNewSession = ref(false);
const enabled = ref(true);
const showCronPicker = ref(false);
const showImportSkill = ref(false);

function emptyCapabilities(): ScheduledTaskCapabilities {
  return { skillNames: [], pluginIds: [], connectorIds: [], expertId: null };
}

const capabilities = ref<ScheduledTaskCapabilities>(emptyCapabilities());

// Touch tracking — errors only show after the user interacts with a field
const touched = ref({ name: false, cron: false, project: false, payload: false });

const isEdit = computed(() => !!props.task);

const projectOptions = computed(() =>
  projectStore.projects.map((p) => ({ label: p.name, value: p.id })),
);

watch(() => props.show, (visible) => {
  if (visible && props.task) {
    // Edit mode: populate fields
    name.value = props.task.name;
    description.value = props.task.description;
    cronExpression.value = props.task.cronExpression;
    taskType.value = props.task.taskType;
    projectId.value = props.task.projectId;
    createNewSession.value = props.task.createNewSession;
    enabled.value = props.task.enabled;
    capabilities.value = {
      skillNames: [...(props.task.capabilities?.skillNames ?? [])],
      pluginIds: [...(props.task.capabilities?.pluginIds ?? [])],
      connectorIds: [...(props.task.capabilities?.connectorIds ?? [])],
      expertId: props.task.capabilities?.expertId ?? null,
    };
    try {
      const p = JSON.parse(props.task.payload || "{}");
      promptText.value = p.prompt || "";
      reminderText.value = p.message || "";
    } catch {
      promptText.value = "";
      reminderText.value = "";
    }
  } else if (visible) {
    // Create mode: reset fields
    name.value = "";
    description.value = "";
    cronExpression.value = "0 9 * * *";
    taskType.value = "prompt";
    promptText.value = "";
    reminderText.value = "";
    projectId.value = null;
    createNewSession.value = false;
    enabled.value = true;
    capabilities.value = emptyCapabilities();
  }
  // Always reset touched state when dialog opens
  touched.value = { name: false, cron: false, project: false, payload: false };
});

// ─── Validation ───

const cronValid = computed(() => validateCron(cronExpression.value));
const cronHuman = computed(() => cronToHuman(cronExpression.value));
const cronNextRuns = computed(() => getNextRuns(cronExpression.value, 3));

const nameError = computed(() => touched.value.name && !name.value.trim());
const cronError = computed(() => touched.value.cron && cronExpression.value.trim() !== "" && !cronValid.value);
const projectError = computed(() => touched.value.project && taskType.value === "prompt" && !projectId.value);
const payloadError = computed(() => {
  if (!touched.value.payload) return false;
  return taskType.value === "prompt" ? !promptText.value.trim() : !reminderText.value.trim();
});

const formValid = computed(() => {
  if (!name.value.trim()) return false;
  if (!cronValid.value) return false;
  if (taskType.value === "prompt" && !projectId.value) return false;
  if (taskType.value === "prompt" && !promptText.value.trim()) return false;
  if (taskType.value === "reminder" && !reminderText.value.trim()) return false;
  return true;
});

const taskTypeOptions = computed(() => [
  { label: t("scheduledTasks.type.prompt"), value: "prompt" as TaskType },
  { label: t("scheduledTasks.type.reminder"), value: "reminder" as TaskType },
]);

function applyPreset(expr: string) {
  cronExpression.value = expr;
  touched.value.cron = true;
}

function addSkill(name: string) {
  if (!capabilities.value.skillNames.includes(name)) {
    capabilities.value.skillNames = [...capabilities.value.skillNames, name];
  }
}

function removeSkill(name: string) {
  capabilities.value.skillNames = capabilities.value.skillNames.filter((item) => item !== name);
}

function handleSubmit() {
  // Mark all fields as touched so errors display
  touched.value = { name: true, cron: true, project: true, payload: true };
  if (!formValid.value) return;

  const payload = JSON.stringify(
    taskType.value === "prompt"
      ? { prompt: promptText.value }
      : { message: reminderText.value },
  );

  emit("submit", {
    name: name.value.trim(),
    description: description.value.trim(),
    cronExpression: cronExpression.value,
    taskType: taskType.value,
    payload,
    projectId: taskType.value === "prompt" ? (projectId.value ?? undefined) : undefined,
    createNewSession: taskType.value === "prompt" ? createNewSession.value : undefined,
    capabilities: taskType.value === "prompt" ? {
      skillNames: [...capabilities.value.skillNames],
      pluginIds: [...capabilities.value.pluginIds],
      connectorIds: [...capabilities.value.connectorIds],
      expertId: capabilities.value.expertId,
    } : emptyCapabilities(),
    enabled: enabled.value,
  });
}
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    :title="isEdit ? t('scheduledTasks.edit') : t('scheduledTasks.create')"
    :style="{ width: '520px' }"
    :mask-closable="false"
    @update:show="(v: boolean) => !v && emit('close')"
  >
    <div class="task-form">
      <!-- Name -->
      <div class="form-field">
        <label class="form-label"><span class="required-mark">*</span>{{ t('scheduledTasks.name') }}</label>
        <NInput
          v-model:value="name"
          :placeholder="t('scheduledTasks.name')"
          :status="nameError ? 'error' : undefined"
          @blur="touched.name = true"
        />
        <span v-if="nameError" class="field-error">{{ t('scheduledTasks.required') }}</span>
      </div>

      <!-- Description -->
      <div class="form-field">
        <label class="form-label">{{ t('scheduledTasks.description') }}</label>
        <NInput v-model:value="description" type="textarea" :rows="2" :placeholder="t('scheduledTasks.description')" />
      </div>

      <!-- Cron Expression -->
      <div class="form-field">
        <label class="form-label"><span class="required-mark">*</span>{{ t('scheduledTasks.cronExpression') }}</label>
        <div class="cron-input-row">
          <NInput
            v-model:value="cronExpression"
            :placeholder="t('scheduledTasks.cronPlaceholder')"
            :status="cronError ? 'error' : undefined"
            class="cron-input"
            @blur="touched.cron = true"
          />
          <NButton size="small" quaternary @click="showCronPicker = true" :title="t('scheduledTasks.visualPicker')">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="1" y="3" width="14" height="11" rx="2" stroke="currentColor" stroke-width="1.3"/>
              <path d="M1 6h14" stroke="currentColor" stroke-width="1.3"/>
              <path d="M5 1v4M11 1v4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
              <circle cx="5" cy="9" r="1" fill="currentColor"/>
              <circle cx="8" cy="9" r="1" fill="currentColor"/>
              <circle cx="11" cy="9" r="1" fill="currentColor"/>
              <circle cx="5" cy="12" r="1" fill="currentColor"/>
              <circle cx="8" cy="12" r="1" fill="currentColor"/>
            </svg>
          </NButton>
        </div>
        <div class="cron-preview" v-if="cronExpression && cronValid">
          <span class="cron-human">{{ cronHuman }}</span>
          <span v-if="cronNextRuns.length" class="cron-next-hint">{{ cronNextRuns[0] }}</span>
        </div>
        <!-- Presets -->
        <div class="cron-presets">
          <span class="presets-label">{{ t('scheduledTasks.presets') }}:</span>
          <NTag
            v-for="preset in cronPresets"
            :key="preset.expression"
            size="small"
            :bordered="false"
            class="preset-tag"
            @click="applyPreset(preset.expression)"
          >
            {{ preset.label }}
          </NTag>
        </div>
        <span v-if="cronError" class="field-error">{{ t('scheduledTasks.invalidCron') }}</span>
      </div>

      <!-- Task Type + Target Project (same row) -->
      <div class="form-row">
        <div class="form-field form-field-half">
          <label class="form-label">{{ t('scheduledTasks.taskType') }}</label>
          <NSelect v-model:value="taskType" :options="taskTypeOptions" />
        </div>
        <div v-if="taskType === 'prompt'" class="form-field form-field-half">
          <label class="form-label">
            <span class="required-mark">*</span>{{ t('scheduledTasks.targetProject') }}
            <NTooltip placement="top" :delay="200">
              <template #trigger>
                <span class="label-help" aria-label="info">
                  <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                    <circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.2"/>
                    <path d="M7 6.3v3.2M7 4v.6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
                  </svg>
                </span>
              </template>
              {{ t('scheduledTasks.targetProjectHint') }}
            </NTooltip>
          </label>
          <NSelect
            v-model:value="projectId"
            :options="projectOptions"
            :placeholder="t('scheduledTasks.selectProject')"
            :status="projectError ? 'error' : undefined"
            clearable
            @update:show="(v: boolean) => { if (!v) touched.project = true; }"
          />
          <span v-if="projectError" class="field-error">{{ t('scheduledTasks.required') }}</span>
        </div>
      </div>

      <!-- Create New Session (prompt tasks only) -->
      <div v-if="taskType === 'prompt'" class="form-field form-field-row">
        <label class="form-label">
          {{ t('scheduledTasks.createNewSession') }}
          <NTooltip placement="top" :delay="200">
            <template #trigger>
              <span class="label-help" aria-label="info">
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                  <circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.2"/>
                  <path d="M7 6.3v3.2M7 4v.6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
                </svg>
              </span>
            </template>
            {{ t('scheduledTasks.reuseSessionHint') }}
          </NTooltip>
        </label>
        <NSwitch v-model:value="createNewSession" />
      </div>

      <!-- Payload -->
      <div class="form-field">
        <label class="form-label"><span class="required-mark">*</span>{{ t('scheduledTasks.payload') }}</label>
        <div v-if="taskType === 'prompt'" class="scheduled-composer">
          <div v-if="capabilities.skillNames.length" class="skill-chips">
            <span v-for="skill in capabilities.skillNames" :key="skill" class="skill-chip">
              <span class="chip-icon">◇</span>
              <span class="chip-name">{{ skill }}</span>
              <button class="chip-remove" type="button" @click="removeSkill(skill)">×</button>
            </span>
          </div>
          <NInput
            v-model:value="promptText"
            type="textarea"
            :rows="3"
            :autosize="{ minRows: 3, maxRows: 5 }"
            :placeholder="t('scheduledTasks.payloadPromptPlaceholder')"
            :status="payloadError ? 'error' : undefined"
            class="composer-input"
            @blur="touched.payload = true"
          />
          <div class="composer-toolbar">
            <ChatCapabilityToolbar
              mode="draft"
              :project-id="projectId ?? ''"
              :skill-names="capabilities.skillNames"
              :plugin-ids="capabilities.pluginIds"
              :connector-ids="capabilities.connectorIds"
              :expert-id="capabilities.expertId"
              @select-skill="addSkill"
              @update:plugin-ids="capabilities.pluginIds = $event"
              @update:connector-ids="capabilities.connectorIds = $event"
              @update:expert-id="capabilities.expertId = $event"
              @import-skill="showImportSkill = true"
              @manage-connectors="emit('manage-connectors')"
            />
          </div>
        </div>
        <NInput
          v-else
          v-model:value="reminderText"
          type="textarea"
          :rows="3"
          :placeholder="t('scheduledTasks.payloadReminderPlaceholder')"
          :status="payloadError ? 'error' : undefined"
          @blur="touched.payload = true"
        />
        <span v-if="payloadError" class="field-error">{{ t('scheduledTasks.required') }}</span>
      </div>

      <!-- Enabled -->
      <div class="form-field form-field-row">
        <label class="form-label">{{ t('scheduledTasks.enabled') }}</label>
        <NSwitch v-model:value="enabled" />
      </div>
    </div>

    <template #footer>
      <NSpace justify="end">
        <NButton @click="emit('close')">{{ t('delete.cancel') }}</NButton>
        <NButton
          type="primary"
          :disabled="!formValid"
          @click="handleSubmit"
        >
          {{ isEdit ? t('delete.confirm') : t('scheduledTasks.create') }}
        </NButton>
      </NSpace>
    </template>
  </NModal>

  <ImportSkillDialog :show="showImportSkill" @close="showImportSkill = false" />

  <!-- Cron Picker Modal -->
  <NModal
    :show="showCronPicker"
    preset="card"
    :title="t('scheduledTasks.visualPicker')"
    :style="{ width: '560px', maxWidth: '95vw' }"
    :mask-closable="true"
    @update:show="(v: boolean) => showCronPicker = v"
  >
    <CronPicker v-model="cronExpression" />
    <template #footer>
      <NSpace justify="end">
        <NButton @click="showCronPicker = false">{{ t('delete.confirm') }}</NButton>
      </NSpace>
    </template>
  </NModal>
</template>

<style scoped>
.task-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-field-row {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.form-row {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.form-field-half {
  flex: 1;
  min-width: 0;
}

.form-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
}

.required-mark {
  color: var(--danger-color, #e53935);
  font-weight: 600;
  margin-right: 2px;
}

.field-error {
  font-size: 11px;
  color: var(--danger-color, #e53935);
  line-height: 1.3;
}

.label-help {
  display: inline-flex;
  align-items: center;
  color: var(--text-muted);
  cursor: help;
  transition: color 0.15s;
}
.label-help:hover {
  color: var(--primary-color);
}

.cron-input-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.cron-input {
  flex: 1;
}

.cron-preview {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
}

.cron-human {
  font-size: 12px;
  font-weight: 500;
  color: var(--primary-color);
}

.cron-next-hint {
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--text-muted);
  background: var(--background-page);
  padding: 1px 6px;
  border-radius: 4px;
}

.cron-presets {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding-top: 4px;
}

.presets-label {
  font-size: 11px;
  color: var(--text-muted);
}

.preset-tag {
  cursor: pointer;
  transition: all 0.15s;
}
.preset-tag:hover {
  opacity: 0.8;
}

/* Keep the task dialog close action quiet until it is needed. */
:deep(.n-card__close) {
  top: 16px;
  right: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid var(--border-default);
  border-radius: 50%;
  background: var(--bg-surface);
  color: var(--text-muted);
  box-shadow: 0 2px 8px rgba(20, 28, 45, 0.06);
  transition: color var(--transition-fast), background var(--transition-fast), border-color var(--transition-fast), box-shadow var(--transition-fast), transform var(--transition-fast);
}

:deep(.n-card__close:hover) {
  border-color: color-mix(in srgb, var(--primary-color) 40%, var(--border-default));
  background: color-mix(in srgb, var(--primary-color) 9%, var(--bg-surface));
  color: var(--primary-color);
  box-shadow: 0 4px 12px rgba(20, 28, 45, 0.1);
  transform: rotate(90deg);
}

:deep(.n-card__close:focus-visible) {
  outline: 2px solid color-mix(in srgb, var(--primary-color) 55%, transparent);
  outline-offset: 2px;
}

.scheduled-composer {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
}

.scheduled-composer .composer-input :deep(.n-input) {
  background: var(--bg-surface);
}

.composer-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 2px 0;
}

.skill-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.skill-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 23px;
  padding: 0 4px 0 7px;
  border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border-default));
  border-radius: var(--radius-sm);
  background: var(--accent-dim);
  color: var(--accent);
  font-size: 11px;
}

.chip-name { font-family: var(--font-mono); }
.chip-icon { font-size: 13px; line-height: 1; }
.chip-remove {
  width: 17px;
  height: 17px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: currentColor;
  cursor: pointer;
  font-size: 14px;
  line-height: 15px;
}
.chip-remove:hover { background: color-mix(in srgb, currentColor 16%, transparent); }
</style>
