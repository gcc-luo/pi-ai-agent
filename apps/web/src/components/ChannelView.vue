<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { NInput, NSpin, NEmpty, useMessage } from "naive-ui";
import { useChannelStore } from "../stores/channel.js";
import { useI18n } from "../i18n/index.js";
import type { ChannelConfigDto, ChannelDescriptor } from "@pi-web-ui/shared";
import ChannelCard from "./ChannelCard.vue";
import ChannelConfigDialog from "./ChannelConfigDialog.vue";
import ConfirmDialog from "./ConfirmDialog.vue";
import WeChatChannelDrawer from "./WeChatChannelDrawer.vue";

const store = useChannelStore();
const { t } = useI18n();
const message = useMessage();

const showConfigDialog = ref(false);
const configDescriptor = ref<ChannelDescriptor | null>(null);
const configExisting = ref<ChannelConfigDto | null>(null);
const deleteTarget = ref<ChannelConfigDto | null>(null);
const testingId = ref<string | null>(null);
const showWeChatDrawer = ref(false);

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
    message.error(e?.message ?? t("channel.deleteFailed"));
  } finally {
    deleteTarget.value = null;
  }
}

async function handleToggle(payload: { descriptor: ChannelDescriptor; config: ChannelConfigDto; enabled: boolean }) {
  try {
    await store.update(payload.config.id, { enabled: payload.enabled });
  } catch (e: any) {
    message.error(e?.message ?? t("channel.updateFailed"));
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

// The wechat card derives its state from the worker, not the configs DB.
// No DB row is auto-created for it — the descriptor alone drives its presence.
const allCards = computed(() =>
  store.descriptors.map((d) => ({ descriptor: d, config: store.configFor(d.type) })),
);

const searchQuery = ref("");

// Fuzzy match by channel label, type key, or user-set config name.
function matchesQuery(label: string, type: string, configName: string | undefined, q: string): boolean {
  if (!q) return true;
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  if (label.toLowerCase().includes(needle)) return true;
  if (type.toLowerCase().includes(needle)) return true;
  if (configName && configName.toLowerCase().includes(needle)) return true;
  return false;
}

const cards = computed(() => {
  const q = searchQuery.value;
  return allCards.value.filter((item) =>
    matchesQuery(item.descriptor.label, item.descriptor.type, item.config?.name, q),
  );
});

const wechatConfig = computed(() => store.configFor("wechat"));
</script>

<template>
  <div class="channel-view">
    <header class="channel-header">
      <div class="channel-header-info">
        <h1 class="channel-title">{{ t('channel.title') }}</h1>
        <p class="channel-subtitle">{{ t('channel.subtitle') }}</p>
      </div>
      <div class="channel-header-actions">
        <NInput
          v-model:value="searchQuery"
          size="small"
          clearable
          :placeholder="t('channel.search')"
          class="channel-search"
        />
      </div>
    </header>

    <div v-if="store.loading" class="channel-state">
      <NSpin size="medium" />
    </div>
    <div v-else-if="allCards.length === 0" class="channel-state">
      <NEmpty :description="t('channel.noConfig')" />
    </div>
    <div v-else-if="cards.length === 0" class="channel-state">
      <NEmpty>
        <template #default>
          {{ t('channel.noResults', { query: searchQuery }) }}
        </template>
      </NEmpty>
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
        @wechat-configure="showWeChatDrawer = true"
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

    <WeChatChannelDrawer
      :show="showWeChatDrawer"
      :config="wechatConfig"
      @update:show="showWeChatDrawer = $event"
      @saved="store.loadAll()"
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

.channel-search {
  width: 240px;
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
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
  align-content: start;
}

@media (max-width: 1500px) {
  .channel-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}

@media (max-width: 1120px) {
  .channel-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 720px) {
  .channel-header { padding: 24px; }
  .channel-grid { grid-template-columns: 1fr; padding: 16px 24px; }
}
</style>
