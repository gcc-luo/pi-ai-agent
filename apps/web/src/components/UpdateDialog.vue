<script setup lang="ts">
import { computed } from "vue";
import { NModal, NProgress } from "naive-ui";
import { useI18n } from "../i18n/index.js";
import { renderMarkdown } from "../utils/markdown.js";
import { useUpdateStore } from "../stores/update.js";

defineProps<{ show: boolean }>();
const emit = defineEmits<{ (e: "close"): void }>();

const { t } = useI18n();
const updateStore = useUpdateStore();
const renderedNotes = computed(() =>
  renderMarkdown(updateStore.updateInfo?.body ?? ""),
);

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
  <NModal
    :show="show"
    @update:show="(v: boolean) => { if (!v) handleLater(); }"
  >
    <div
      class="update-dialog"
      role="dialog"
      aria-labelledby="update-dialog-title"
      @click.stop
    >
      <div class="update-header">
        <svg class="update-icon" width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M10 3v10m0 0l-3-3m3 3l3-3M4 15h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <h3 id="update-dialog-title" class="update-title">{{ t('update.title') }}</h3>
        <button
          type="button"
          class="update-close"
          :aria-label="t('common.close')"
          @click="handleLater"
        >
          ×
        </button>
      </div>

      <!-- New version available -->
      <div v-if="updateStore.status === 'available'" class="update-state update-state-available">
        <div class="update-scroll-area">
          <div class="update-version-row">
            <div class="update-release-meta">
              <span v-if="updateStore.updateInfo?.body" class="update-notes-label">
                {{ t('update.releaseNotes') }}
              </span>
              <span v-if="updateStore.updateInfo?.date" class="update-date">
                {{ updateStore.updateInfo.date }}
              </span>
            </div>
            <span class="update-version-badge">v{{ updateStore.updateInfo?.version }}</span>
          </div>

          <div v-if="updateStore.updateInfo?.body" class="update-notes">
            <div class="update-notes-content" v-html="renderedNotes" />
          </div>
        </div>

        <div class="update-actions">
          <button type="button" class="update-btn update-btn-secondary" data-test="update-later" @click="handleLater">
            {{ t('update.later') }}
          </button>
          <button
            type="button"
            class="update-btn update-btn-primary"
            data-test="update-download"
            :disabled="updateStore.status !== 'available'"
            @click="handleDownload"
          >
            {{ t('update.downloadInstall') }}
          </button>
        </div>
      </div>

      <!-- Downloading -->
      <div v-else-if="updateStore.status === 'downloading'" class="update-state">
        <div class="update-scroll-area update-status-area" aria-live="polite">
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
      </div>

      <!-- Ready to install -->
      <div v-else-if="updateStore.status === 'ready'" class="update-state">
        <div class="update-scroll-area update-status-area" aria-live="polite">
          <p class="update-status-text">{{ t('update.readyToInstall') }}</p>
          <p class="update-hint-text">{{ t('update.restartHint') }}</p>
        </div>
        <div class="update-actions">
          <button type="button" class="update-btn update-btn-secondary" data-test="update-later" @click="handleLater">
            {{ t('update.later') }}
          </button>
          <button
            type="button"
            class="update-btn update-btn-primary"
            data-test="update-restart"
            :disabled="updateStore.status !== 'ready'"
            @click="handleRestart"
          >
            {{ t('update.restartNow') }}
          </button>
        </div>
      </div>

      <!-- Installing -->
      <div v-else-if="updateStore.status === 'installing'" class="update-state">
        <div class="update-scroll-area update-status-area" aria-live="polite">
          <p class="update-status-text">{{ t('update.installing') }}</p>
        </div>
      </div>

      <!-- Error -->
      <div v-else-if="updateStore.status === 'error'" class="update-state">
        <div class="update-scroll-area update-status-area" role="alert">
          <p class="update-status-text update-error-text">{{ t('update.error') }}</p>
          <p class="update-error-detail">{{ updateStore.errorMessage }}</p>
        </div>
        <div class="update-actions">
          <button type="button" class="update-btn update-btn-secondary" data-test="update-later" @click="handleLater">
            {{ t('update.close') }}
          </button>
        </div>
      </div>
    </div>
  </NModal>
</template>

<style scoped>
.update-dialog {
  display: flex;
  flex-direction: column;
  width: min(760px, calc(100vw - 32px));
  max-height: min(720px, calc(100vh - 32px));
  overflow: hidden;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  background: var(--bg-surface);
  box-shadow: var(--shadow-lg);
}

.update-header {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  padding: 20px 28px 16px;
  border-bottom: 1px solid var(--border-subtle);
}

.update-icon {
  flex-shrink: 0;
  color: var(--accent);
}

.update-title {
  margin: 0;
  color: var(--text-primary);
  font-family: var(--font-sans);
  font-size: 21px;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.update-close {
  display: grid;
  width: 30px;
  height: 30px;
  margin-left: auto;
  place-items: center;
  border: 1px solid transparent;
  border-radius: 50%;
  background: transparent;
  color: var(--text-muted);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast);
}

.update-close:hover {
  border-color: var(--border-default);
  background: var(--bg-hover);
  color: var(--text-primary);
}

.update-state {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
}

.update-scroll-area {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  padding: 26px 38px 22px;
}

.update-state-available .update-scroll-area {
  padding-top: 24px;
}

.update-version-row {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 16px;
}

.update-release-meta {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.update-notes-label {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.update-version-badge {
  padding: 8px 12px;
  border-radius: var(--radius-md);
  background: var(--accent-dim);
  color: var(--accent);
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 600;
}

.update-date {
  color: var(--text-muted);
  font-size: 12px;
}

.update-notes {
  margin-top: 22px;
}

.update-notes-content {
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.7;
  word-break: break-word;
}

.update-notes-content :deep(p) {
  margin: 0 0 12px;
}

.update-notes-content :deep(p:last-child) {
  margin-bottom: 0;
}

.update-notes-content :deep(h1),
.update-notes-content :deep(h2),
.update-notes-content :deep(h3),
.update-notes-content :deep(h4) {
  margin: 24px 0 8px;
  color: var(--text-primary);
  font-family: var(--font-sans);
  font-weight: 600;
  line-height: 1.3;
}

.update-notes-content :deep(h1:first-child),
.update-notes-content :deep(h2:first-child),
.update-notes-content :deep(h3:first-child) {
  margin-top: 0;
}

.update-notes-content :deep(h1) { font-size: 20px; }
.update-notes-content :deep(h2) {
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-subtle);
  font-size: 17px;
}
.update-notes-content :deep(h3) { font-size: 15px; }

.update-notes-content :deep(ul),
.update-notes-content :deep(ol) {
  margin: 8px 0 14px;
  padding-left: 22px;
}

.update-notes-content :deep(li) { margin: 4px 0; }
.update-notes-content :deep(a) {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.update-notes-content :deep(code) {
  padding: 2px 5px;
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 0.88em;
}

.update-notes-content :deep(pre) {
  max-width: 100%;
  overflow-x: auto;
  padding: 12px 14px;
  border-left: 2px solid var(--accent);
  border-radius: var(--radius-sm);
  background: var(--bg-void);
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.5;
}

.update-notes-content :deep(pre code) {
  padding: 0;
  background: transparent;
}

.update-notes-content :deep(blockquote) {
  margin: 12px 0;
  padding-left: 14px;
  border-left: 2px solid var(--accent);
  color: var(--text-secondary);
}

.update-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  flex-shrink: 0;
  padding: 16px 28px 22px;
  border-top: 1px solid var(--border-subtle);
  background: var(--bg-surface);
}

.update-btn {
  min-height: 36px;
  padding: 8px 16px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast), opacity var(--transition-fast);
}

.update-btn-secondary {
  border-color: var(--border-default);
  background: var(--bg-hover);
  color: var(--text-secondary);
}

.update-btn-secondary:hover {
  border-color: var(--border-active);
  color: var(--text-primary);
}

.update-btn-primary {
  background: var(--accent);
  color: var(--bg-void);
}

.update-btn-primary:hover {
  background: var(--accent-hover);
}

.update-btn:focus-visible,
.update-close:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.update-btn:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.update-status-area {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
}

.update-status-text {
  margin: 0;
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 600;
}

.update-progress-text {
  margin-top: 8px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 12px;
  text-align: center;
}

.update-hint-text {
  margin-top: 8px;
  color: var(--text-muted);
  font-size: 12px;
}

.update-error-text { color: var(--rose); }

.update-error-detail {
  margin-top: 8px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 12px;
  overflow-wrap: anywhere;
}

@media (max-width: 560px) {
  .update-dialog {
    width: calc(100vw - 20px);
    max-height: calc(100vh - 20px);
  }

  .update-header { padding: 17px 18px 14px; }
  .update-title { font-size: 18px; }
  .update-scroll-area { padding: 22px 18px 18px; }
  .update-actions { flex-wrap: wrap; padding: 14px 18px 18px; }
  .update-btn { flex: 1 1 140px; }
}
</style>
