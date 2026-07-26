<script setup lang="ts">
import { computed } from "vue";
import { NButton, NSwitch, NTag } from "naive-ui";
import type { ChannelConfigDto, ChannelDescriptor } from "@pi-web-ui/shared";
import { useI18n } from "../i18n/index.js";

const props = defineProps<{
  descriptor: ChannelDescriptor;
  config: ChannelConfigDto | null;
}>();

const emit = defineEmits<{
  (e: "configure", descriptor: ChannelDescriptor): void;
  (e: "edit", payload: { descriptor: ChannelDescriptor; config: ChannelConfigDto }): void;
  (e: "delete", payload: { descriptor: ChannelDescriptor; config: ChannelConfigDto }): void;
  (e: "toggle-enabled", payload: { descriptor: ChannelDescriptor; config: ChannelConfigDto; enabled: boolean }): void;
  (e: "test", payload: { descriptor: ChannelDescriptor; config: ChannelConfigDto }): void;
}>();

const { t } = useI18n();

const hasConfig = computed(() => props.config !== null);
const isEnabled = computed(() => props.config?.enabled === true);
</script>

<template>
  <div class="channel-card" :class="{ unavailable: !descriptor.available }">
    <div class="card-header">
      <span class="channel-icon">{{ descriptor.icon }}</span>
      <div class="card-titles">
        <span class="channel-name">{{ descriptor.label }}</span>
        <NTag v-if="!descriptor.available" size="tiny" :bordered="false" type="warning">
          {{ t('channel.comingSoon') }}
        </NTag>
        <NTag v-else-if="hasConfig" size="tiny" :bordered="false" type="success">
          {{ t('channel.configured') }}
        </NTag>
        <NTag v-else size="tiny" :bordered="false" type="default">
          {{ t('channel.notConfigured') }}
        </NTag>
      </div>
    </div>

    <p class="channel-description">{{ descriptor.description }}</p>

    <div class="card-actions">
      <template v-if="!descriptor.available">
        <NButton size="small" disabled>{{ t('channel.configure') }}</NButton>
      </template>
      <template v-else-if="!hasConfig">
        <NButton size="small" type="primary" @click="emit('configure', descriptor)">
          {{ t('channel.createFirst') }}
        </NButton>
      </template>
      <template v-else>
        <div class="enabled-toggle">
          <span class="toggle-label">{{ t('channel.enabled') }}</span>
          <NSwitch
            size="small"
            :value="isEnabled"
            @update:value="(v: boolean) => emit('toggle-enabled', { descriptor, config: props.config!, enabled: v })"
          />
        </div>
        <div class="action-buttons">
          <NButton size="tiny" quaternary @click="emit('test', { descriptor, config: props.config! })">
            {{ t('channel.test') }}
          </NButton>
          <NButton size="tiny" quaternary @click="emit('edit', { descriptor, config: props.config! })">
            {{ t('channel.edit') }}
          </NButton>
          <NButton size="tiny" quaternary type="error" @click="emit('delete', { descriptor, config: props.config! })">
            {{ t('channel.delete') }}
          </NButton>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.channel-card {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--background-panel);
  transition: all var(--transition-fast);
}
.channel-card:hover {
  border-color: var(--primary-color);
  box-shadow: var(--shadow-md);
}
.channel-card.unavailable {
  opacity: 0.85;
}

.card-header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.channel-icon {
  font-size: 28px;
  line-height: 1;
  flex-shrink: 0;
}

.card-titles {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.channel-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.channel-description {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  flex: 1;
}

.card-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: auto;
}

.enabled-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
}

.toggle-label {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
}

.action-buttons {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
</style>
