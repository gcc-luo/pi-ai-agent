<script setup lang="ts">
import { useConnectionStore } from "../stores/connection.js";
import { useI18n } from "../i18n/index.js";

defineProps<{
  activeNav: "chat" | "model" | "skill-store";
}>();

defineEmits<{
  (e: "navigate", nav: "chat" | "model" | "skill-store"): void;
}>();

const connection = useConnectionStore();
const { currentLocale, toggleLocale } = useI18n();
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
      <button
        class="nav-item"
        :class="{ active: activeNav === 'chat' }"
        @click="$emit('navigate', 'chat')"
      >
        <svg class="nav-icon" width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path d="M3 5a3 3 0 013-3h6a3 3 0 013 3v6a3 3 0 01-3 3H8.5L4 17v-3H6a3 3 0 01-3-3V5z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
          <path d="M6 7h6M6 9.5h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
        </svg>
        <span class="nav-label">会话</span>
      </button>

      <button
        class="nav-item"
        :class="{ active: activeNav === 'model' }"
        @click="$emit('navigate', 'model')"
      >
        <svg class="nav-icon" width="18" height="18" viewBox="0 0 18 18" fill="none">
          <rect x="2" y="3" width="14" height="12" rx="2" stroke="currentColor" stroke-width="1.4"/>
          <circle cx="9" cy="9" r="3" stroke="currentColor" stroke-width="1.4"/>
          <circle cx="9" cy="9" r="1" fill="currentColor"/>
        </svg>
        <span class="nav-label">模型</span>
      </button>

      <button
        class="nav-item"
        :class="{ active: activeNav === 'skill-store' }"
        @click="$emit('navigate', 'skill-store')"
      >
        <svg class="nav-icon" width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path d="M3 6l1.5-2.5h9L15 6M3 6v8a1 1 0 001 1h10a1 1 0 001-1V6M3 6h12M7 10h4" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/>
        </svg>
        <span class="nav-label">技能</span>
      </button>
    </div>

    <!-- Spacer -->
    <div class="nav-spacer" />

    <!-- Footer -->
    <div class="nav-footer">
      <button
        class="lang-toggle"
        @click="toggleLocale()"
        :title="currentLocale === 'en' ? '切换到中文' : 'Switch to English'"
      >
        <span class="lang-label">{{ currentLocale === 'en' ? '中' : 'EN' }}</span>
      </button>

      <div class="user-section">
        <div class="user-avatar">
          <span class="avatar-text">管</span>
        </div>
        <div class="user-info">
          <span class="user-name">管理员</span>
          <span class="workspace-name">个人空间</span>
        </div>
      </div>

      <div class="connection-indicator" :class="connection.status" :title="connection.status">
        <span class="conn-dot" />
      </div>
    </div>
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

.nav-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 12px 0;
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
  font-size: 11px;
  font-weight: 500;
}

/* ─── Spacer ─── */

.nav-spacer {
  flex: 1;
}

/* ─── Footer ─── */

.nav-footer {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px;
  gap: 12px;
}

.lang-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);
}
.lang-toggle:hover {
  border-color: var(--primary-color);
  color: var(--primary-color);
}

.lang-label {
  font-size: 11px;
  font-weight: 600;
}

.user-section {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px;
}

.user-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--primary-light);
  color: var(--primary-color);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.avatar-text {
  font-size: 12px;
  font-weight: 600;
}

.user-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.user-name {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.workspace-name {
  font-size: 10px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.connection-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px 0;
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
