<script setup lang="ts">
import { NModal } from "naive-ui";
import { onMounted, computed } from "vue";
import { useI18n } from "../i18n/index.js";
import { useThemeStore, THEME_OPTIONS, type ThemeMode } from "../stores/theme.js";
import { useUpdateStore } from "../stores/update.js";
import { isTauri } from "../utils/platform.js";

const props = defineProps<{ show: boolean }>();
const emit = defineEmits<{ (e: "close"): void }>();

const { t, currentLocale, toggleLocale } = useI18n();
const themeStore = useThemeStore();
const updateStore = useUpdateStore();

const isDesktop = isTauri();

const updateButtonText = computed(() => {
  if (updateStore.status === "checking") return t("settings.checking");
  if (updateStore.status === "no-update") return t("settings.noUpdate");
  if (updateStore.isAvailable) return t("settings.newVersion");
  return t("settings.checkUpdate");
});

const canCheckUpdate = computed(() => {
  return updateStore.status !== "checking" && updateStore.status !== "downloading";
});

function handleCheckUpdate() {
  if (!canCheckUpdate.value) return;
  updateStore.checkForUpdate();
}

onMounted(() => {
  updateStore.getAppVersion();
});
</script>

<template>
  <NModal :show="show" @update:show="(v: boolean) => { if (!v) $emit('close'); }">
    <div class="settings-dialog" @click.stop>
      <div class="settings-header">
        <h3 class="settings-title">{{ t('settings.title') }}</h3>
        <button class="settings-close" @click="$emit('close')">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
          </svg>
        </button>
      </div>

      <div class="settings-body">
        <div class="setting-row">
          <div class="setting-info">
            <span class="setting-label">{{ t('settings.language') }}</span>
            <span class="setting-desc">{{ t('settings.languageDesc') }}</span>
          </div>
          <button class="lang-switch" @click="toggleLocale()">
            {{ currentLocale === 'en' ? 'English' : '中文' }}
          </button>
        </div>

        <div class="setting-row">
          <div class="setting-info">
            <span class="setting-label">{{ t('settings.theme') }}</span>
            <span class="setting-desc">{{ t('settings.themeDesc') }}</span>
          </div>
          <div class="theme-switcher">
            <button
              v-for="option in THEME_OPTIONS"
              :key="option.value"
              class="theme-option"
              :class="{ active: themeStore.mode === option.value }"
              @click="themeStore.set(option.value as ThemeMode)"
            >
              {{ option.label }}
            </button>
          </div>
        </div>

        <!-- Update section (desktop only) -->
        <template v-if="isDesktop">
          <div class="setting-row">
            <div class="setting-info">
              <span class="setting-label">{{ t('settings.checkUpdate') }}</span>
              <span class="setting-desc" v-if="updateStore.currentVersion">
                {{ t('settings.currentVersion') }}: v{{ updateStore.currentVersion }}
              </span>
            </div>
            <button
              class="lang-switch"
              :disabled="!canCheckUpdate"
              @click="handleCheckUpdate"
            >
              {{ updateButtonText }}
            </button>
          </div>
        </template>

      </div>
    </div>
  </NModal>
</template>

<style scoped>
.settings-dialog {
  width: 440px;
  background: var(--bg-deep);
  border: 1px solid var(--border-default);
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}

.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 12px;
}

.settings-title {
  font-family: var(--font-mono);
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.settings-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
}
.settings-close:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.settings-body {
  padding: 0 20px 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 16px;
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
}

.setting-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.setting-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.setting-desc {
  font-size: 11px;
  color: var(--text-muted);
}

.lang-switch {
  flex-shrink: 0;
  padding: 6px 14px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--transition-fast);
}
.lang-switch:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}
.lang-switch:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.theme-switcher {
  display: flex;
  gap: 0;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  overflow: hidden;
  flex-shrink: 0;
}

.theme-option {
  padding: 5px 12px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition-fast);
  border-right: 1px solid var(--border-default);
}
.theme-option:last-child {
  border-right: none;
}
.theme-option:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.theme-option.active {
  background: var(--accent-dim);
  color: var(--accent);
  font-weight: 600;
}
</style>
