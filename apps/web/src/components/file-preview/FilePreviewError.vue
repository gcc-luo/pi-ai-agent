<script setup lang="ts">
import { useI18n } from "../../i18n/index.js";

defineProps<{ message: string; retryTestId: string }>();
const emit = defineEmits<{ retry: [] }>();
const { t } = useI18n();
</script>

<template>
  <div class="file-preview-error" role="alert">
    <span>{{ message }}</span>
    <button type="button" :data-test="retryTestId" @click="emit('retry')">
      {{ t('chat.retry') }}
    </button>
  </div>
</template>

<style scoped>
.file-preview-error {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 20px;
  color: var(--rose);
  font-size: 12px;
  text-align: center;
  overflow-wrap: anywhere;
}

.file-preview-error button {
  padding: 5px 10px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.file-preview-error button:hover {
  border-color: var(--accent);
  color: var(--text-primary);
}
</style>
