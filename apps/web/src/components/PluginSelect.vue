<script setup lang="ts">
import { computed, watch } from "vue";
import { NSelect } from "naive-ui";
import { usePluginStore } from "../stores/plugin.js";
import { useI18n } from "../i18n/index.js";

const props = defineProps<{
  sessionId: string;
  disabled?: boolean;
}>();

const plugins = usePluginStore();
const { t } = useI18n();

const selected = computed(() => plugins.selectedBySession[props.sessionId] ?? []);
const options = computed(() => plugins.enabledPlugins.map((plugin) => ({
  label: `${plugin.icon} ${plugin.name}`,
  value: plugin.id,
  disabled: plugin.status === "unavailable",
})));

watch(
  () => props.sessionId,
  async (sessionId) => {
    if (plugins.plugins.length === 0) await plugins.loadAll();
    await plugins.loadSession(sessionId);
  },
  { immediate: true },
);

async function update(value: string[]) {
  try {
    await plugins.setSessionPlugins(props.sessionId, value);
  } catch {
    // Store restores the previous selection and exposes a concise error.
  }
}
</script>

<template>
  <div class="plugin-select" :title="plugins.error || t('plugins.sessionHint')">
    <NSelect
      :value="selected"
      :options="options"
      multiple
      clearable
      size="small"
      max-tag-count="responsive"
      :placeholder="t('plugins.select')"
      :disabled="disabled || plugins.updatingSessionId === sessionId"
      data-test="session-plugin-select"
      @update:value="update"
    />
  </div>
</template>

<style scoped>
.plugin-select {
  width: 210px;
  min-width: 150px;
}

.plugin-select :deep(.n-base-selection) {
  min-height: 26px;
  background: transparent;
  border-radius: var(--radius-sm);
}

.plugin-select :deep(.n-base-selection-label) {
  background: transparent;
}

.plugin-select :deep(.n-base-selection-tag-wrapper) {
  max-width: 150px;
}
</style>
