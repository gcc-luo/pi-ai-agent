<script setup lang="ts">
import { NModal, NProgress } from "naive-ui";
import { useI18n } from "../i18n/index.js";
import { useUpdateStore } from "../stores/update.js";

defineProps<{ show: boolean }>();
const emit = defineEmits<{ (e: "close"): void }>();

const { t } = useI18n();
const updateStore = useUpdateStore();

function handleLater() {
  updateStore.reset();
  emit("close");
}

function handleDownload() {
  updateStore.downloadAndInstall();
}

function handleRestart() {
  updateStore.installAndRestart();
}
</script>

<template>
  <NModal :show="show" @update:show="(v: boolean) => { if (!v) { updateStore.reset(); emit('close'); } }">
    <div class="update-dialog" @click.stop>
      <div class="update-header">
        <svg class="update-icon" width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M10 3v10m0 0l-3-3m3 3l3-3M4 15h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <h3 class="update-title">{{ t('update.title') }}</h3>
      </div>

      <!-- New version available -->
      <div v-if="updateStore.status === 'available'" class="update-body">
        <div class="update-version-row">
          <span class="update-version-badge">v{{ updateStore.updateInfo?.version }}</span>
          <span v-if="updateStore.updateInfo?.date" class="update-date">{{ updateStore.updateInfo.date }}</span>
        </div>
        <div v-if="updateStore.updateInfo?.body" class="update-notes">
          <div class="update-notes-label">{{ t('update.releaseNotes') }}</div>
          <div class="update-notes-content">{{ updateStore.updateInfo.body }}</div>
        </div>
        <div class="update-actions">
          <button class="update-btn update-btn-secondary" @click="handleLater">{{ t('update.later') }}</button>
          <button class="update-btn update-btn-primary" @click="handleDownload">{{ t('update.downloadInstall') }}</button>
        </div>
      </div>

      <!-- Downloading -->
      <div v-else-if="updateStore.status === 'downloading'" class="update-body">
        <p class="update-status-text">{{ t('update.downloading') }}</p>
        <NProgress
          type="line"
          :percentage="updateStore.downloadProgress"
          :show-indicator="true"
          :height="8"
          :border-radius="4"
          color="var(--accent)"
          rail-color="var(--bg-hover)"
        />
        <p class="update-progress-text">{{ updateStore.downloadProgress }}%</p>
      </div>

      <!-- Ready to install -->
      <div v-else-if="updateStore.status === 'ready'" class="update-body">
        <p class="update-status-text">{{ t('update.readyToInstall') }}</p>
        <p class="update-hint-text">{{ t('update.restartHint') }}</p>
        <div class="update-actions">
          <button class="update-btn update-btn-secondary" @click="handleLater">{{ t('update.later') }}</button>
          <button class="update-btn update-btn-primary" @click="handleRestart">{{ t('update.restartNow') }}</button>
        </div>
      </div>

      <!-- Installing -->
      <div v-else-if="updateStore.status === 'installing'" class="update-body">
        <p class="update-status-text">{{ t('update.installing') }}</p>
      </div>

      <!-- Error -->
      <div v-else-if="updateStore.status === 'error'" class="update-body">
        <p class="update-status-text update-error-text">{{ t('update.error') }}</p>
        <p class="update-error-detail">{{ updateStore.errorMessage }}</p>
        <div class="update-actions">
          <button class="update-btn update-btn-secondary" @click="handleLater">{{ t('update.close') }}</button>
        </div>
      </div>

    </div>
  </NModal>
</template>

<style scoped>
.update-dialog {
  width: 440px;
  background: var(--bg-deep);
  border: 1px solid var(--border-default);
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}

.update-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 20px 12px;
}

.update-icon {
  color: var(--accent);
  flex-shrink: 0;
}

.update-title {
  font-family: var(--font-mono);
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.update-body {
  padding: 0 20px 20px;
}

.update-version-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.update-version-badge {
  display: inline-block;
  padding: 2px 10px;
  border-radius: var(--radius-sm);
  background: var(--accent-dim);
  color: var(--accent);
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 600;
}

.update-date {
  font-size: 12px;
  color: var(--text-muted);
}

.update-notes {
  margin-bottom: 16px;
}

.update-notes-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 4px;
}

.update-notes-content {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
  max-height: 160px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.update-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 16px;
}

.update-btn {
  padding: 7px 18px;
  border: none;
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.update-btn-secondary {
  background: var(--bg-hover);
  color: var(--text-secondary);
  border: 1px solid var(--border-default);
}
.update-btn-secondary:hover {
  color: var(--text-primary);
  border-color: var(--text-muted);
}

.update-btn-primary {
  background: var(--accent);
  color: #fff;
}
.update-btn-primary:hover {
  opacity: 0.9;
}

.update-status-text {
  font-size: 14px;
  color: var(--text-primary);
  font-weight: 500;
  margin: 8px 0 4px;
}

.update-progress-text {
  font-size: 12px;
  color: var(--text-muted);
  text-align: center;
  margin-top: 4px;
}

.update-hint-text {
  font-size: 12px;
  color: var(--text-muted);
  margin: 4px 0 0;
}

.update-error-text {
  color: #ff7b7b;
}

.update-error-detail {
  font-size: 12px;
  color: var(--text-muted);
  word-break: break-all;
  margin: 4px 0 0;
}
</style>
