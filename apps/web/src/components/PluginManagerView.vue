<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { NButton, NEmpty, NInput, NModal, NSwitch, NSpin } from "naive-ui";
import type { PluginDto } from "@pi-web-ui/shared";
import { usePluginStore } from "../stores/plugin.js";
import { useI18n } from "../i18n/index.js";

const plugins = usePluginStore();
const { t } = useI18n();
const detailPlugin = ref<PluginDto | null>(null);
const searchQuery = ref("");

const filteredPlugins = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  if (!query) return plugins.plugins;

  return plugins.plugins.filter((plugin) => [
    plugin.name,
    plugin.id,
    plugin.source,
    manifestText(plugin.id, "description", plugin.description),
  ].some((value) => value.toLowerCase().includes(query)));
});

onMounted(() => plugins.loadAll());

async function toggle(pluginId: string, enabled: boolean) {
  try {
    await plugins.setEnabled(pluginId, enabled);
  } catch (error) {
    plugins.error = error instanceof Error ? error.message : String(error);
  }
}

function statusLabel(status: string): string {
  return t(`plugins.status.${status}`);
}

function openDetails(plugin: PluginDto) {
  detailPlugin.value = plugin;
}

function closeDetails() {
  detailPlugin.value = null;
}

function manifestText(
  pluginId: string,
  field: "description" | "capability" | "permission",
  fallback: string,
  index?: number,
): string {
  const key = index === undefined
    ? `plugins.manifest.${pluginId}.${field}`
    : `plugins.manifest.${pluginId}.${field}.${index}`;
  const translated = t(key);
  return translated === key ? fallback : translated;
}
</script>

<template>
  <main class="plugins-view">
    <header class="view-header">
      <div>
        <h1>{{ t('plugins.title') }}</h1>
        <p>{{ t('plugins.subtitle') }}</p>
      </div>
      <NInput
        v-model:value="searchQuery"
        size="small"
        clearable
        :placeholder="t('plugins.search')"
        class="plugin-search"
      />
    </header>

    <NSpin :show="plugins.loading">
      <div class="plugin-body">
        <div v-if="plugins.error" class="error-banner">{{ plugins.error }}</div>
        <div v-if="!plugins.loading && !filteredPlugins.length" class="plugin-empty">
          <NEmpty :description="t('plugins.noResults')" />
        </div>
        <section v-else-if="filteredPlugins.length" class="plugin-grid">
          <article v-for="plugin in filteredPlugins" :key="plugin.id" class="plugin-card">
            <div class="card-head">
              <div class="plugin-icon">{{ plugin.icon }}</div>
              <div class="plugin-heading">
                <div class="plugin-title-row">
                  <h2>{{ plugin.name }}</h2>
                  <span v-if="plugin.builtin" class="badge">{{ t('plugins.builtin') }}</span>
                  <span v-if="plugin.official" class="badge official">{{ t('plugins.official') }}</span>
                </div>
                <p class="meta">v{{ plugin.version }} · {{ plugin.source }}</p>
              </div>
              <NSwitch
                :value="plugin.enabled"
                @update:value="toggle(plugin.id, $event)"
              />
            </div>

            <p class="description">
              {{ manifestText(plugin.id, 'description', plugin.description) }}
            </p>

            <div class="plugin-card-footer">
              <div class="status-line">
                <span class="status-dot" :class="plugin.status" />
                <span>{{ statusLabel(plugin.status) }}</span>
                <span v-if="plugin.error" class="status-error">{{ plugin.error }}</span>
              </div>

              <div class="plugin-card-actions">
                <NButton size="tiny" quaternary @click="openDetails(plugin)">
                  {{ t('plugins.details') }}
                </NButton>
              </div>
            </div>
          </article>
        </section>
      </div>
    </NSpin>

    <NModal
      :show="detailPlugin !== null"
      preset="card"
      :title="detailPlugin?.name ?? ''"
      :style="{ width: '560px', maxWidth: '92vw' }"
      :bordered="false"
      :mask-closable="true"
      data-test="plugin-details-modal"
      @update:show="(show: boolean) => { if (!show) closeDetails(); }"
    >
      <template v-if="detailPlugin" #header-extra>
        <span v-if="detailPlugin.builtin" class="badge">{{ t('plugins.builtin') }}</span>
        <span v-if="detailPlugin.official" class="badge official">{{ t('plugins.official') }}</span>
      </template>

      <div v-if="detailPlugin" class="plugin-details">
        <div class="plugin-detail-meta">
          <span>{{ t('plugins.detailVersion') }}: v{{ detailPlugin.version }}</span>
          <span>{{ t('plugins.detailSource') }}: {{ detailPlugin.source }}</span>
          <span>{{ t('plugins.detailStatus') }}: {{ statusLabel(detailPlugin.status) }}</span>
        </div>

        <p class="plugin-detail-description">
          {{ manifestText(detailPlugin.id, 'description', detailPlugin.description) }}
        </p>

        <section class="plugin-detail-section">
          <h3>{{ t('plugins.capabilities') }}</h3>
          <div class="chips">
            <span v-for="(item, index) in detailPlugin.capabilities" :key="item">
              {{ manifestText(detailPlugin.id, 'capability', item, index) }}
            </span>
          </div>
        </section>

        <section class="plugin-detail-section">
          <h3>{{ t('plugins.permissions') }} · {{ detailPlugin.permissions.length }}</h3>
          <ul class="plugin-permissions">
            <li v-for="(permission, index) in detailPlugin.permissions" :key="permission">
              {{ manifestText(detailPlugin.id, 'permission', permission, index) }}
            </li>
          </ul>
        </section>

        <p v-if="detailPlugin.error" class="plugin-detail-error">{{ detailPlugin.error }}</p>
      </div>
    </NModal>
  </main>
</template>

<style scoped>
.plugins-view {
  flex: 1;
  min-width: 0;
  overflow: auto;
  padding: 0;
  background: var(--bg-surface);
}

.view-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 32px 48px 24px;
  border-bottom: 1px solid var(--border-color);
}

.view-header h1 {
  margin: 0 0 4px;
  color: var(--text-primary);
  font-size: 24px;
  font-weight: 700;
}

.view-header p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 13px;
}

.plugin-search {
  width: 220px;
}

.plugin-body {
  padding: 24px 48px;
}

.error-banner {
  margin-bottom: 14px;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--rose) 40%, var(--border-default));
  border-radius: var(--radius-md);
  color: var(--rose);
  background: var(--rose-dim);
}

.plugin-empty {
  display: flex;
  justify-content: center;
  padding: 64px 0;
}

.plugin-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
  align-items: stretch;
}

.plugin-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 12px;
  padding: 20px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--background-panel);
  transition: all var(--transition-fast);
}

.plugin-card:hover {
  border-color: var(--primary-color);
  box-shadow: var(--shadow-md);
}

.card-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.plugin-icon {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 8px;
  background: var(--accent-dim);
  font-size: 19px;
}

.plugin-heading {
  flex: 1;
  min-width: 0;
}

.plugin-title-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.plugin-title-row h2 {
  margin: 0;
  color: var(--text-primary);
  font-size: 15px;
  font-weight: 600;
}

.badge {
  padding: 2px 6px;
  border-radius: 999px;
  background: var(--bg-hover);
  color: var(--text-muted);
  font-size: 10px;
}

.badge.official {
  background: var(--accent-dim);
  color: var(--accent);
}

.meta {
  margin: 4px 0 0;
  color: var(--text-faint);
  font-family: var(--font-mono);
  font-size: 10px;
}

.description {
  margin: 0;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.status-line {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  gap: 7px;
  color: var(--text-muted);
  font-size: 12px;
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--text-faint);
}

.status-dot.enabled { background: var(--amber); }
.status-dot.starting { background: var(--amber); animation: pulse 1.2s infinite; }
.status-dot.running { background: var(--green); }
.status-dot.error, .status-dot.unavailable { background: var(--rose); }

.status-error {
  overflow: hidden;
  color: var(--rose);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.chips span {
  padding: 4px 7px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: 11px;
}

.plugin-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-width: 0;
  gap: 12px;
  margin-top: auto;
}

.plugin-card-actions {
  flex-shrink: 0;
}

.plugin-details {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-height: 68vh;
  overflow-y: auto;
}

.plugin-detail-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 11px;
}

.plugin-detail-description {
  margin: 0;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.plugin-detail-section h3 {
  margin: 0 0 8px;
  color: var(--text-muted);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: .06em;
}

.plugin-permissions {
  margin: 0;
  padding-left: 20px;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.8;
}

.plugin-detail-error {
  margin: 0;
  padding: 8px 10px;
  border-radius: var(--radius-md);
  background: var(--rose-dim);
  color: var(--rose);
  font-size: 12px;
}
</style>
