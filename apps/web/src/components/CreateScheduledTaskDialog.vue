<script setup lang="ts">
import { ref, watch, computed } from "vue";
import { NModal, NInput, NButton, NSelect, NSwitch, NSpace, NTag } from "naive-ui";
import type { TaskType, ScheduledTaskDto } from "@pi-web-ui/shared";
import { useI18n } from "../i18n/index.js";
import { cronPresets, cronToHuman, validateCron } from "../utils/cron-helper.js";

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
    enabled: boolean;
  }): void;
}>();

const { t } = useI18n();

const name = ref("");
const description = ref("");
const cronExpression = ref("0 9 * * *");
const taskType = ref<TaskType>("prompt");
const promptText = ref("");
const reminderText = ref("");
const enabled = ref(true);

const isEdit = computed(() => !!props.task);

watch(() => props.show, (visible) => {
  if (visible && props.task) {
    // Edit mode: populate fields
    name.value = props.task.name;
    description.value = props.task.description;
    cronExpression.value = props.task.cronExpression;
    taskType.value = props.task.taskType;
    enabled.value = props.task.enabled;
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
    enabled.value = true;
  }
});

const cronValid = computed(() => validateCron(cronExpression.value));
const cronHuman = computed(() => cronToHuman(cronExpression.value));

const taskTypeOptions = computed(() => [
  { label: t("scheduledTasks.type.prompt"), value: "prompt" as TaskType },
  { label: t("scheduledTasks.type.reminder"), value: "reminder" as TaskType },
]);

function applyPreset(expr: string) {
  cronExpression.value = expr;
}

function handleSubmit() {
  if (!name.value.trim() || !cronValid.value) return;

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
        <label class="form-label">{{ t('scheduledTasks.name') }}</label>
        <NInput v-model:value="name" :placeholder="t('scheduledTasks.name')" />
      </div>

      <!-- Description -->
      <div class="form-field">
        <label class="form-label">{{ t('scheduledTasks.description') }}</label>
        <NInput v-model:value="description" type="textarea" :rows="2" :placeholder="t('scheduledTasks.description')" />
      </div>

      <!-- Cron Expression -->
      <div class="form-field">
        <label class="form-label">{{ t('scheduledTasks.cronExpression') }}</label>
        <NInput
          v-model:value="cronExpression"
          :placeholder="t('scheduledTasks.cronPlaceholder')"
          :status="cronValid ? undefined : 'error'"
        />
        <div class="cron-preview" v-if="cronExpression">
          <span class="cron-human">{{ cronHuman }}</span>
          <span class="cron-raw">{{ cronExpression }}</span>
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
      </div>

      <!-- Task Type -->
      <div class="form-field">
        <label class="form-label">{{ t('scheduledTasks.taskType') }}</label>
        <NSelect v-model:value="taskType" :options="taskTypeOptions" />
      </div>

      <!-- Payload -->
      <div class="form-field">
        <label class="form-label">{{ t('scheduledTasks.payload') }}</label>
        <NInput
          v-if="taskType === 'prompt'"
          v-model:value="promptText"
          type="textarea"
          :rows="3"
          :placeholder="t('scheduledTasks.payloadPromptPlaceholder')"
        />
        <NInput
          v-else
          v-model:value="reminderText"
          type="textarea"
          :rows="3"
          :placeholder="t('scheduledTasks.payloadReminderPlaceholder')"
        />
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
          :disabled="!name.trim() || !cronValid"
          @click="handleSubmit"
        >
          {{ isEdit ? t('delete.confirm') : t('scheduledTasks.create') }}
        </NButton>
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

.form-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
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

.cron-raw {
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
</style>
