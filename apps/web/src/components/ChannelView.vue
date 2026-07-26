<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { NButton, NSpin, NEmpty, useMessage } from "naive-ui";
import { useChannelStore } from "../stores/channel.js";
import { useI18n } from "../i18n/index.js";
import type { ChannelConfigDto, ChannelDescriptor } from "@pi-web-ui/shared";
import ChannelCard from "./ChannelCard.vue";
import ChannelConfigDialog from "./ChannelConfigDialog.vue";
import ConfirmDialog from "./ConfirmDialog.vue";

const store = useChannelStore();
const { t } = useI18n();
const message = useMessage();

const showConfigDialog = ref(false);
const configDescriptor = ref<ChannelDescriptor | null>(null);
const configExisting = ref<ChannelConfigDto | null>(null);
const deleteTarget = ref<ChannelConfigDto | null>(null);
const testingId = ref<string | null>(null);

onMounted(() => store.loadAll());

function startConfigure(descriptor: ChannelDescriptor) {
  configDescriptor.value = descriptor;
  configExisting.value = null;
  showConfigDialog.value = true;
}

function startEdit(payload: { descriptor: ChannelDescriptor; config: ChannelConfigDto }) {
  configDescriptor.value = payload.descriptor;
  configExisting.value = payload.config;
  showConfigDialog.value = true;
}

function requestDelete(payload: { descriptor: ChannelDescriptor; config: ChannelConfigDto }) {
  deleteTarget.value = payload.config;
}

async function confirmDelete() {
  if (!deleteTarget.value) return;
  const id = deleteTarget.value.id;
  try {
    await store.remove(id);
    message.success(t("file.deleted"));
  } catch (e: any) {
    message.error(e?.message ?? "Delete failed");
  } finally {
    deleteTarget.value = null;
  }
}

async function handleToggle(payload: { descriptor: ChannelDescriptor; config: ChannelConfigDto; enabled: boolean }) {
  try {
    await store.update(payload.config.id, { enabled: payload.enabled });
  } catch (e: any) {
    message.error(e?.message ?? "Update failed");
    await store.loadAll();
  }
}

async function handleTest(payload: { descriptor: ChannelDescriptor; config: ChannelConfigDto }) {
  testingId.value = payload.config.id;
  try {
    const result = await store.test(payload.config.id);
    if (result.ok) {
      message.success(t("channel.testSuccess"));
    } else {
      message.error(`${t("channel.testFailed")}: ${result.error ?? ""}`);
    }
  } catch (e: any) {
    message.error(e?.message ?? t("channel.testFailed"));
  } finally {
    testingId.value = null;
  }
}

// Hide wechat from the grid? No — show it as a placeholder, the descriptor
// already carries available:false which the card renders as "coming soon".
const cards = computed(() =>
  store.descriptors.map((d) => ({ descriptor: d, config: store.configFor(d.type) })),
);
</script>

<template>
  <div class="channel-view">
    <header class="channel-header">
      <div class="channel-header-info">
        <h1 class="channel-title">{{ t('channel.title') }}</h1>
        <p class="channel-subtitle">{{ t('channel.subtitle') }}</p>
      </div>
      <div class="channel-header-actions">
        <NButton size="small" quaternary :loading="store.loading" @click="store.loadAll()">
          {{ t('file.refresh') }}
        </NButton>
      </div>
    </header>

    <div v-if="store.loading" class="channel-state">
      <NSpin size="medium" />
    </div>
    <div v-else-if="cards.length === 0" class="channel-state">
      <NEmpty :description="t('channel.noConfig')" />
    </div>
    <div v-else class="channel-grid">
      <ChannelCard
        v-for="item in cards"
        :key="item.descriptor.type"
        :descriptor="item.descriptor"
        :config="item.config"
        @configure="startConfigure"
        @edit="startEdit"
        @delete="requestDelete"
        @toggle-enabled="handleToggle"
        @test="handleTest"
      />
    </div>

    <ChannelConfigDialog
      :show="showConfigDialog"
      :descriptor="configDescriptor"
      :existing="configExisting"
      @update:show="showConfigDialog = $event"
      @saved="showConfigDialog = false; store.loadAll()"
    />

    <ConfirmDialog
      :show="deleteTarget !== null"
      :title="t('channel.delete')"
      :message="t('channel.deleteConfirm')"
      :confirm-label="t('channel.delete')"
      :cancel-label="t('channel.cancel')"
      :danger="true"
      @close="deleteTarget = null"
      @confirm="confirmDelete"
    />
  </div>
</template>

<style scoped>
.channel-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: var(--bg-surface);
  overflow: hidden;
}

.channel-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 32px 48px 24px;
  border-bottom: 1px solid var(--border-color);
}

.channel-header-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.channel-title {
  font-size: 24px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

.channel-subtitle {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 0;
}

.channel-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.channel-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 60px 0;
}

.channel-grid {
  flex: 1;
  overflow-y: auto;
  padding: 24px 48px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
  align-content: start;
}
</style>
