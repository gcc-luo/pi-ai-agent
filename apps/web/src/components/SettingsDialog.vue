<script setup lang="ts">
import { NModal, NSwitch } from "naive-ui";
import { useI18n } from "../i18n/index.js";
import { useThemeStore } from "../stores/theme.js";
import { useModeStore } from "../stores/mode.js";

defineProps<{ show: boolean }>();
defineEmits<{ (e: "close"): void }>();

const { t, currentLocale, toggleLocale } = useI18n();
const themeStore = useThemeStore();
const modeStore = useModeStore();
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
            <span class="setting-label">{{ t('settings.darkMode') }}</span>
            <span class="setting-desc">{{ t('settings.darkModeDesc') }}</span>
          </div>
          <NSwitch :value="themeStore.isDark" @update:value="themeStore.toggle()" />
        </div>

        <div class="setting-row">
          <div class="setting-info">
            <span class="setting-label">{{ t('settings.workMode') }}</span>
            <span class="setting-desc">{{ t('settings.workModeDesc') }}</span>
          </div>
          <div class="mode-switch">
            <button
              class="mode-btn"
              :class="{ active: !modeStore.isCoding }"
              @click="modeStore.set('office')"
            >{{ t('settings.modeOffice') }}</button>
            <button
              class="mode-btn"
              :class="{ active: modeStore.isCoding }"
              @click="modeStore.set('coding')"
            >{{ t('settings.modeCoding') }}</button>
          </div>
        </div>
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
.lang-switch:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.mode-switch {
  display: flex;
  gap: 0;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  overflow: hidden;
  flex-shrink: 0;
}

.mode-btn {
  padding: 6px 14px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--transition-fast);
}
.mode-btn:first-child {
  border-right: 1px solid var(--border-default);
}
.mode-btn:hover {
  color: var(--text-primary);
}
.mode-btn.active {
  background: var(--accent, var(--primary-color));
  color: #fff;
}
</style>
