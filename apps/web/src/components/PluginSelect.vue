<script setup lang="ts">
import { computed, watch, ref } from "vue";
import { NPopover } from "naive-ui";
import type { PluginDto } from "@pi-web-ui/shared";
import { usePluginStore } from "../stores/plugin.js";
import { useI18n } from "../i18n/index.js";

const props = defineProps<{
  sessionId: string;
  disabled?: boolean;
}>();

const plugins = usePluginStore();
const { t } = useI18n();
const showPopover = ref(false);

const selectedIds = computed(() => plugins.selectedBySession[props.sessionId] ?? []);
const availablePlugins = computed(() => plugins.enabledPlugins);
const selectedPlugins = computed(() =>
  selectedIds.value
    .map((id) => plugins.plugins.find((plugin) => plugin.id === id))
    .filter((plugin): plugin is PluginDto => Boolean(plugin)),
);
const primarySelectedPlugin = computed(() => selectedPlugins.value[0] ?? null);
const saving = computed(() => plugins.updatingSessionId === props.sessionId);

watch(
  () => props.sessionId,
  async (sessionId) => {
    if (plugins.plugins.length === 0) await plugins.loadAll();
    await plugins.loadSession(sessionId);
  },
  { immediate: true },
);

function isSelected(pluginId: string): boolean {
  return selectedIds.value.includes(pluginId);
}

function pluginDescription(plugin: PluginDto): string {
  const key = `plugins.manifest.${plugin.id}.description`;
  const translated = t(key);
  return translated === key ? plugin.description : translated;
}

async function update(value: string[]) {
  try {
    await plugins.setSessionPlugins(props.sessionId, value);
  } catch {
    // Store restores the previous selection and exposes a concise error.
  }
}

async function togglePlugin(pluginId: string) {
  if (saving.value) return;
  const next = isSelected(pluginId)
    ? selectedIds.value.filter((id) => id !== pluginId)
    : [...selectedIds.value, pluginId];
  await update(next);
}

async function clearPlugins() {
  if (saving.value || selectedIds.value.length === 0) return;
  await update([]);
}
</script>

<template>
  <div class="plugin-select" :title="plugins.error || t('plugins.sessionHint')">
    <NPopover v-model:show="showPopover" placement="top-start" trigger="click" :width="340">
      <template #trigger>
        <button
          class="plugin-picker-trigger"
          :class="{ active: selectedIds.length > 0 }"
          :title="t('plugins.select')"
          :aria-pressed="selectedIds.length > 0"
          :disabled="disabled || saving"
          data-test="session-plugin-select"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
            <path d="M6.2 3.2V1.8M11.8 3.2V1.8M5 6h8v4.2a4 4 0 01-4 4H8a3 3 0 01-3-3V6z" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" />
            <path d="M9 14.2V16M4 6h10" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" />
          </svg>
          <span class="plugin-trigger-label">{{ t('plugins.select') }}</span>
        </button>
      </template>

      <div class="plugin-picker-body">
        <div class="plugin-picker-header">
          <span class="plugin-picker-title">{{ t('plugins.select') }}</span>
          <button
            v-if="selectedIds.length"
            class="plugin-clear"
            :disabled="saving"
            @click="clearPlugins"
          >{{ t('plugins.clear') }}</button>
        </div>
        <p class="plugin-picker-hint">{{ t('plugins.sessionHint') }}</p>

        <div v-if="!availablePlugins.length" class="plugin-picker-empty">
          {{ t('plugins.noneAvailable') }}
        </div>
        <div v-else class="plugin-picker-list">
          <button
            v-for="plugin in availablePlugins"
            :key="plugin.id"
            class="plugin-picker-item"
            :class="{ selected: isSelected(plugin.id) }"
            :disabled="saving || plugin.status === 'unavailable'"
            @click="togglePlugin(plugin.id)"
          >
            <span class="plugin-item-copy">
              <span class="plugin-item-name">{{ plugin.icon }} {{ plugin.name }}</span>
              <span class="plugin-item-description">{{ pluginDescription(plugin) }}</span>
            </span>
            <svg v-if="isSelected(plugin.id)" class="plugin-selected-mark" width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M2.5 7.2l2.8 2.8 6.2-6.1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
        </div>
      </div>
    </NPopover>

    <span
      v-if="primarySelectedPlugin"
      class="active-plugin-chip"
      :title="selectedPlugins.map((plugin) => plugin.name).join(', ')"
    >
      <span>{{ primarySelectedPlugin.icon }}</span>
      <span class="active-plugin-label">
        {{ selectedPlugins.length === 1 ? primarySelectedPlugin.name : t('plugins.selectedCount', { count: selectedPlugins.length }) }}
      </span>
      <button
        class="active-plugin-clear"
        :disabled="saving"
        :title="t('plugins.clear')"
        @click="clearPlugins"
      >×</button>
    </span>
  </div>
</template>

<style scoped>
.plugin-select {
  display: flex;
  align-items: center;
  min-width: 0;
}

.plugin-picker-trigger {
  display: flex;
  align-items: center;
  justify-content: center;
  width: auto;
  min-width: 62px;
  height: 26px;
  gap: 5px;
  padding: 0 8px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
  flex-shrink: 0;
}
.plugin-trigger-label {
  font-size: 11px;
  white-space: nowrap;
}
.plugin-picker-trigger:hover:not(:disabled),
.plugin-picker-trigger.active {
  color: var(--text-primary);
}
.plugin-picker-trigger:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.plugin-picker-body {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.plugin-picker-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.plugin-picker-title {
  font-size: 13px;
  font-weight: 650;
  color: var(--text-primary);
}
.plugin-picker-hint {
  margin: 0;
  font-size: 11px;
  line-height: 1.45;
  color: var(--text-muted);
}
.plugin-clear {
  border: 0;
  padding: 2px 0;
  background: transparent;
  color: var(--accent);
  font-size: 11px;
  cursor: pointer;
}
.plugin-clear:disabled,
.active-plugin-clear:disabled {
  cursor: default;
  opacity: 0.55;
}
.plugin-picker-list {
  display: flex;
  max-height: 300px;
  flex-direction: column;
  overflow-y: auto;
}
.plugin-picker-item {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  width: 100%;
  padding: 8px 6px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.plugin-picker-item:hover,
.plugin-picker-item.selected {
  background: var(--bg-hover);
}
.plugin-picker-item:disabled {
  cursor: default;
}
.plugin-item-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 2px;
}
.plugin-item-name {
  overflow: hidden;
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.plugin-item-description {
  display: -webkit-box;
  overflow: hidden;
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.35;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.plugin-selected-mark {
  flex: 0 0 auto;
  margin-top: 4px;
  color: var(--accent);
}
.plugin-picker-empty {
  padding: 14px 0;
  color: var(--text-muted);
  font-size: 12px;
  text-align: center;
}

.active-plugin-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 180px;
  height: 26px;
  padding: 0 5px 0 7px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border-default));
  border-radius: var(--radius-sm);
  background: var(--bg-hover);
  color: var(--text-primary);
  font-size: 11px;
  line-height: 1;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.active-plugin-label {
  overflow: hidden;
  text-overflow: ellipsis;
}
.active-plugin-clear {
  width: 17px;
  height: 17px;
  flex-shrink: 0;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 15px;
  line-height: 15px;
}
.active-plugin-clear:hover {
  background: var(--border-default);
  color: var(--text-primary);
}
</style>
