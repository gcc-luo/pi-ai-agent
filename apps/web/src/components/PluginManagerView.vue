<script setup lang="ts">
import { onMounted } from "vue";
import { NSwitch, NSpin } from "naive-ui";
import { usePluginStore } from "../stores/plugin.js";
import { useI18n } from "../i18n/index.js";

const plugins = usePluginStore();
const { t } = useI18n();

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
    </header>

    <NSpin :show="plugins.loading">
      <div v-if="plugins.error" class="error-banner">{{ plugins.error }}</div>
      <section class="plugin-grid">
        <article v-for="plugin in plugins.plugins" :key="plugin.id" class="plugin-card">
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

          <div class="status-line">
            <span class="status-dot" :class="plugin.status" />
            <span>{{ statusLabel(plugin.status) }}</span>
            <span v-if="plugin.error" class="status-error">{{ plugin.error }}</span>
          </div>

          <div class="section">
            <h3>{{ t('plugins.capabilities') }}</h3>
            <div class="chips">
              <span v-for="(item, index) in plugin.capabilities" :key="item">
                {{ manifestText(plugin.id, 'capability', item, index) }}
              </span>
            </div>
          </div>

          <details class="permissions">
            <summary>{{ t('plugins.permissions') }} · {{ plugin.permissions.length }}</summary>
            <ul>
              <li v-for="(permission, index) in plugin.permissions" :key="permission">
                {{ manifestText(plugin.id, 'permission', permission, index) }}
              </li>
            </ul>
          </details>
        </article>
      </section>
    </NSpin>
  </main>
</template>

<style scoped>
.plugins-view {
  flex: 1;
  min-width: 0;
  overflow: auto;
  padding: 28px 34px;
  background: var(--bg-surface);
}

.view-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 24px;
}

.view-header h1 {
  margin: 0 0 7px;
  color: var(--text-primary);
  font-size: 22px;
}

.view-header p {
  margin: 0;
  color: var(--text-muted);
  font-size: 13px;
}

.error-banner {
  margin-bottom: 14px;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--rose) 40%, var(--border-default));
  border-radius: var(--radius-md);
  color: var(--rose);
  background: var(--rose-dim);
}

.plugin-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
  gap: 16px;
}

.plugin-card {
  padding: 20px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  background: var(--bg-deep);
}

.card-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.plugin-icon {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border-radius: 12px;
  background: var(--accent-dim);
  font-size: 22px;
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
  font-size: 16px;
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
  min-height: 40px;
  margin: 16px 0 10px;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.status-line {
  display: flex;
  align-items: center;
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

.section {
  margin-top: 16px;
}

.section h3 {
  margin: 0 0 8px;
  color: var(--text-muted);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: .06em;
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

.permissions {
  margin-top: 15px;
  color: var(--text-muted);
  font-size: 12px;
}

.permissions summary { cursor: pointer; }
.permissions ul { margin: 9px 0 0; padding-left: 20px; line-height: 1.8; }
</style>
