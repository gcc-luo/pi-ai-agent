<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import { useConnectionStore } from "../stores/connection.js";
import { useI18n } from "../i18n/index.js";
import { useTrashStore } from "../stores/trash.js";
import SettingsDialog from "./SettingsDialog.vue";
import UpdateDialog from "./UpdateDialog.vue";
import { useUpdateStore } from "../stores/update.js";
import { isTauri } from "../utils/platform.js";

defineProps<{
  activeNav: "chat" | "model" | "skill-store" | "plugins" | "connectors" | "knowledge-base" | "experts" | "scheduled-tasks" | "channels" | "trash";
}>();

defineEmits<{
  (e: "navigate", nav: "chat" | "model" | "skill-store" | "plugins" | "connectors" | "knowledge-base" | "experts" | "scheduled-tasks" | "channels" | "trash"): void;
}>();

const connection = useConnectionStore();
const { t } = useI18n();
const trashStore = useTrashStore();
const showSettings = ref(false);
const showUpdateDialog = ref(false);
const updateStore = useUpdateStore();

onMounted(async () => {
  if (isTauri()) {
    await updateStore.getAppVersion();
    await updateStore.checkForUpdate();
    if (updateStore.isAvailable) {
      showUpdateDialog.value = true;
    }
  }
});

watch(() => updateStore.status, (newStatus) => {
  if (newStatus === 'available' || newStatus === 'downloading' || newStatus === 'ready' || newStatus === 'installing' || newStatus === 'error') {
    showUpdateDialog.value = true;
  }
});
</script>

<template>
  <nav class="nav-rail">
    <!-- Logo -->
    <div class="nav-header">
      <span class="logo-symbol">π</span>
      <span class="logo-text">PI</span>
    </div>

    <!-- Nav Menu -->
    <div class="nav-menu">
      <div class="nav-group-label">{{ t('nav.groupWorkspace') }}</div>
      <button
        class="nav-item"
        :class="{ active: activeNav === 'chat' }"
        @click="$emit('navigate', 'chat')"
      >
        <svg class="nav-icon" width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path d="M3 5a3 3 0 013-3h6a3 3 0 013 3v6a3 3 0 01-3 3H8.5L4 17v-3H6a3 3 0 01-3-3V5z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
          <path d="M6 7h6M6 9.5h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
        </svg>
        <span class="nav-label">{{ t('nav.chat') }}</span>
      </button>

      <button
        class="nav-item"
        :class="{ active: activeNav === 'model' }"
        @click="$emit('navigate', 'model')"
      >
        <svg class="nav-icon" width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path d="M9 2L15 5.5v7L9 16l-6-3.5v-7L9 2z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
          <path d="M9 9v7M9 9l6-3.5M9 9L3 5.5" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
        </svg>
        <span class="nav-label">{{ t('nav.model') }}</span>
      </button>

      <div class="nav-group-label">{{ t('nav.groupResources') }}</div>
      <button
        class="nav-item"
        :class="{ active: activeNav === 'skill-store' }"
        @click="$emit('navigate', 'skill-store')"
      >
        <svg class="nav-icon" width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path d="M3 6l1.5-2.5h9L15 6M3 6v8a1 1 0 001 1h10a1 1 0 001-1V6M3 6h12M7 10h4" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/>
        </svg>
        <span class="nav-label">{{ t('nav.skillStore') }}</span>
      </button>

      <button
        class="nav-item"
        :class="{ active: activeNav === 'plugins' }"
        @click="$emit('navigate', 'plugins')"
      >
        <svg class="nav-icon" width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path d="M6.2 3.2V1.8M11.8 3.2V1.8M5 6h8v4.2a4 4 0 01-4 4H8a3 3 0 01-3-3V6z" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M9 14.2V16M4 6h10" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/>
        </svg>
        <span class="nav-label">{{ t('nav.plugins') }}</span>
      </button>

      <button class="nav-item" :class="{ active: activeNav === 'connectors' }" @click="$emit('navigate', 'connectors')">
        <svg class="nav-icon" width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path d="m7.1 10.9-1.3 1.3a2.5 2.5 0 0 1-3.5-3.5l2-2a2.5 2.5 0 0 1 3.5 0" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" />
          <path d="m10.9 7.1 1.3-1.3a2.5 2.5 0 0 1 3.5 3.5l-2 2a2.5 2.5 0 0 1-3.5 0" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" />
          <path d="m6.5 11.5 5-5" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" />
        </svg>
        <span class="nav-label">{{ t('nav.connectors') }}</span>
      </button>

      <button
        class="nav-item"
        :class="{ active: activeNav === 'knowledge-base' }"
        @click="$emit('navigate', 'knowledge-base')"
      >
        <svg class="nav-icon" width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path d="M3 3h4a2 2 0 012 2v10a1.5 1.5 0 00-1.5-1.5H3V3z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
          <path d="M15 3h-4a2 2 0 00-2 2v10a1.5 1.5 0 011.5-1.5H15V3z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
        </svg>
        <span class="nav-label">{{ t('nav.knowledgeBase') }}</span>
      </button>

      <button
        class="nav-item"
        :class="{ active: activeNav === 'experts' }"
        @click="$emit('navigate', 'experts')"
      >
        <svg class="nav-icon" width="18" height="18" viewBox="0 0 18 18" fill="none">
          <circle cx="9" cy="6" r="3" stroke="currentColor" stroke-width="1.4"/>
          <path d="M3 16c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
        </svg>
        <span class="nav-label">{{ t('nav.experts') }}</span>
      </button>

      <div class="nav-group-label">{{ t('nav.groupAutomation') }}</div>
      <button
        class="nav-item"
        :class="{ active: activeNav === 'channels' }"
        @click="$emit('navigate', 'channels')"
      >
        <svg class="nav-icon" width="18" height="18" viewBox="0 0 18 18" fill="none">
          <rect x="4.25" y="1.5" width="9.5" height="15" rx="2" stroke="currentColor" stroke-width="1.4"/>
          <path d="M6.8 7.1l1.7 1.6-1.7 1.6M10 10.3h1.4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M8 13.7h2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
        </svg>
        <span class="nav-label">{{ t('nav.channels') }}</span>
      </button>

      <button
        class="nav-item"
        :class="{ active: activeNav === 'scheduled-tasks' }"
        @click="$emit('navigate', 'scheduled-tasks')"
      >
        <svg class="nav-icon" width="18" height="18" viewBox="0 0 18 18" fill="none">
          <circle cx="9" cy="10" r="6" stroke="currentColor" stroke-width="1.4"/>
          <path d="M9 7v3l2 1.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M7 2h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
          <path d="M9 2v2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
        </svg>
        <span class="nav-label">{{ t('nav.scheduledTasks') }}</span>
      </button>

      <div class="nav-group-label">{{ t('nav.groupSystem') }}</div>
      <button
        class="nav-item"
        :class="{ active: activeNav === 'trash' }"
        @click="$emit('navigate', 'trash')"
      >
        <svg class="nav-icon" width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path d="M4 5v9a2 2 0 002 2h6a2 2 0 002-2V5M3 5h12M7 5V3h4v2M7 8v5M11 8v5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span class="nav-label">{{ t('nav.trash') }}</span>
        <span v-if="trashStore.count > 0" class="nav-badge">{{ trashStore.count }}</span>
      </button>
    </div>

    <!-- Spacer -->
    <div class="nav-spacer" />

    <!-- Footer -->
    <div class="nav-footer">
      <div class="connection-indicator" :class="connection.status" :title="connection.status">
        <span class="conn-dot" />
      </div>

      <button
        class="nav-item settings-btn"
        :title="t('settings.title')"
        @click="showSettings = true"
      >
        <svg class="nav-icon" width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path d="M7.5 2.5h3l.3 1.8a5.5 5.5 0 011.5.9l1.7-.6 1.5 2.6-1.4 1.2a5.5 5.5 0 010 1.7l1.4 1.2-1.5 2.6-1.7-.6a5.5 5.5 0 01-1.5.9l-.3 1.8h-3l-.3-1.8a5.5 5.5 0 01-1.5-.9l-1.7.6-1.5-2.6 1.4-1.2a5.5 5.5 0 010-1.7L3 6.3l1.5-2.6 1.7.6a5.5 5.5 0 011.5-.9l.3-1.8z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
          <circle cx="9" cy="9" r="2.2" stroke="currentColor" stroke-width="1.3"/>
        </svg>
        <span class="nav-label">{{ t('settings.title') }}</span>
      </button>
    </div>

    <SettingsDialog :show="showSettings" @close="showSettings = false" />
    <UpdateDialog
      :show="showUpdateDialog || updateStore.isDownloading || updateStore.isReady || updateStore.status === 'installing' || updateStore.status === 'error'"
      @close="showUpdateDialog = false"
    />
  </nav>
</template>

<style scoped>
.nav-rail {
  width: var(--nav-rail-width);
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--background-panel);
  border-right: 1px solid var(--border-color);
  flex-shrink: 0;
}

/* ─── Header ── */

.nav-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 0;
  justify-content: center;
}

.logo-symbol {
  font-size: 22px;
  font-weight: 700;
  color: var(--primary-color);
  line-height: 1;
}

.logo-text {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: 0.05em;
}

/* ─── Menu ─── */

.nav-menu {
  display: flex;
  flex-direction: column;
  padding: 0 12px;
  gap: 4px;
}

.nav-group-label {
  padding: 9px 8px 3px;
  color: var(--text-faint);
  font-size: 9px;
  letter-spacing: 0.12em;
  font-weight: 600;
}

.nav-item {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);
  position: relative;
}

.nav-item:hover {
  background: var(--background-hover);
  color: var(--text-primary);
}

.nav-item.active {
  background: var(--background-selected);
  color: var(--primary-color);
}

.nav-item.active::before {
  content: "";
  position: absolute;
  left: 0;
  top: 8px;
  bottom: 8px;
  width: 3px;
  border-radius: 2px;
  background: var(--primary-color);
}

.nav-icon {
  flex-shrink: 0;
}

.nav-label {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
}

.nav-badge {
  margin-left: auto;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: var(--danger-color);
  color: white;
  font-size: 10px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}

/* ─── Spacer ─── */

.nav-spacer {
  flex: 1;
}

/* ─── Footer ─── */

.nav-footer {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  padding: 0 12px 12px;
  gap: 4px;
}


.connection-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px 0;
}

.conn-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-disabled);
}
.connection-indicator.connected .conn-dot {
  background: var(--success-color);
}
.connection-indicator.connecting .conn-dot {
  background: var(--warning-color);
  animation: pulse 1.5s ease infinite;
}
.connection-indicator.disconnected .conn-dot {
  background: var(--danger-color);
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
</style>
