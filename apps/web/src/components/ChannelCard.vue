<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { NButton, NSwitch, NTag } from "naive-ui";
import type { ChannelConfigDto, ChannelDescriptor } from "@pi-web-ui/shared";
import { api } from "../api/client.js";
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
  (e: "wechat-login"): void;
  (e: "wechat-test"): void;
  (e: "wechat-logout"): void;
}>();

const { t } = useI18n();

const hasConfig = computed(() => props.config !== null);
const isEnabled = computed(() => props.config?.enabled === true);

// WeChat card polls the worker status while mounted.
type WeChatStatus = {
  state: "idle" | "awaiting_scan" | "scanned" | "logged_in" | "expired" | "error";
  qrDataUrl?: string;
  userId?: string;
  error?: string;
};

const wechatStatus = ref<WeChatStatus>({ state: "idle" });
let pollTimer: ReturnType<typeof setInterval> | null = null;

const isWeChat = computed(() => props.descriptor.type === "wechat");

async function refreshWeChat() {
  if (!isWeChat.value) return;
  try {
    wechatStatus.value = await api.wechatStatus();
  } catch {
    // ignore transient polling errors
  }
}

onMounted(() => {
  if (!isWeChat.value) return;
  void refreshWeChat();
  pollTimer = setInterval(refreshWeChat, 2000);
});

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
});
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
        <template v-else-if="isWeChat">
          <NTag v-if="wechatStatus.state === 'logged_in'" size="tiny" :bordered="false" type="success">
            {{ t('channel.wechat.loggedIn') }}
          </NTag>
          <NTag v-else-if="wechatStatus.state === 'error'" size="tiny" :bordered="false" type="error">
            {{ t('channel.wechat.loginFailed') }}
          </NTag>
          <NTag v-else-if="wechatStatus.state === 'awaiting_scan' || wechatStatus.state === 'scanned' || wechatStatus.state === 'expired'" size="tiny" :bordered="false" type="info">
            {{ t('channel.wechat.scanning') }}
          </NTag>
          <NTag v-else size="tiny" :bordered="false" type="default">
            {{ t('channel.notConfigured') }}
          </NTag>
        </template>
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
      <template v-else-if="isWeChat">
        <div class="wechat-state">
          <template v-if="wechatStatus.state === 'awaiting_scan' && wechatStatus.qrDataUrl">
            <img class="wechat-qr" :src="wechatStatus.qrDataUrl" alt="WeChat QR" />
            <span class="wechat-hint">{{ t('channel.wechat.scanning') }}</span>
          </template>
          <template v-else-if="wechatStatus.state === 'scanned'">
            <span class="wechat-hint">{{ t('channel.wechat.scanToConfirm') }}</span>
          </template>
          <template v-else-if="wechatStatus.state === 'logged_in'">
            <span class="wechat-hint">{{ t('channel.wechat.loggedIn') }}: {{ wechatStatus.userId }}</span>
          </template>
          <template v-else-if="wechatStatus.state === 'error'">
            <span class="wechat-hint wechat-error">{{ wechatStatus.error || t('channel.wechat.loginFailed') }}</span>
          </template>
          <template v-else>
            <span class="wechat-hint">{{ t('channel.notConfigured') }}</span>
          </template>
        </div>
        <div class="action-buttons">
          <NButton v-if="wechatStatus.state !== 'logged_in'" size="tiny" type="primary" @click="emit('wechat-login')">
            {{ t('channel.wechat.scanLogin') }}
          </NButton>
          <template v-else>
            <NButton size="tiny" quaternary @click="emit('wechat-test')">{{ t('channel.test') }}</NButton>
            <NButton size="tiny" quaternary type="error" @click="emit('wechat-logout')">{{ t('channel.wechat.logout') }}</NButton>
          </template>
        </div>
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

.wechat-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.wechat-qr {
  width: 140px;
  height: 140px;
  object-fit: contain;
  border-radius: var(--radius-sm);
  background: #fff;
  padding: 4px;
}

.wechat-hint {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
  word-break: break-all;
}

.wechat-error {
  color: var(--rose);
}
</style>
