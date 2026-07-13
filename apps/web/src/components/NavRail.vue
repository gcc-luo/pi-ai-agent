<script setup lang="ts">
import { useThemeStore } from "../stores/theme.js";
import { useConnectionStore } from "../stores/connection.js";
import { useI18n } from "../i18n/index.js";

defineProps<{
  activeNav: "chat" | "model" | "skill-store";
}>();

defineEmits<{
  (e: "navigate", nav: "chat" | "model" | "skill-store"): void;
}>();

const themeStore = useThemeStore();
const connection = useConnectionStore();
const { t, toggleLocale, currentLocale } = useI18n();
</script>

<template>
  <nav class="nav-rail">
    <!-- Logo -->
    <div class="nav-logo">π</div>

    <!-- Nav Items -->
    <div class="nav-items">
      <button
        class="nav-item"
        :class="{ active: activeNav === 'chat' }"
        @click="$emit('navigate', 'chat')"
        :title="t('nav.chat')"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path
            d="M3 5a3 3 0 013-3h6a3 3 0 013 3v6a3 3 0 01-3 3H8.5L4 17v-3H6a3 3 0 01-3-3V5z"
            stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"
          />
          <path d="M6 7h6M6 9.5h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
        </svg>
      </button>
      <button
        class="nav-item"
        :class="{ active: activeNav === 'model' }"
        @click="$emit('navigate', 'model')"
        :title="t('nav.model')"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <rect x="2" y="3" width="14" height="12" rx="2" stroke="currentColor" stroke-width="1.4" />
          <circle cx="9" cy="9" r="3" stroke="currentColor" stroke-width="1.4" />
          <circle cx="9" cy="9" r="1" fill="currentColor" />
          <path d="M6 3V1M12 3V1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
        </svg>
      </button>
      <button
        class="nav-item"
        :class="{ active: activeNav === 'skill-store' }"
        @click="$emit('navigate', 'skill-store')"
        :title="t('nav.skillStore')"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path d="M3 6l1.5-2.5h9L15 6M3 6v8a1 1 0 001 1h10a1 1 0 001-1V6M3 6h12M7 10h4" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round" />
        </svg>
      </button>
    </div>

    <!-- Spacer -->
    <div class="nav-spacer" />

    <!-- Bottom Controls -->
    <div class="nav-bottom">
      <div class="connection-dot" :class="connection.status" :title="connection.status" />
      <button class="nav-toggle" @click="toggleLocale()" :title="currentLocale === 'en' ? t('toggle.zh') : t('toggle.en')">
        <span class="locale-label">{{ currentLocale === 'en' ? '中' : 'EN' }}</span>
      </button>
      <button class="nav-toggle" @click="themeStore.toggle()" :title="themeStore.isDark ? t('toggle.light') : t('toggle.dark')">
        <svg v-if="themeStore.isDark" width="14" height="14" viewBox="0 0 14 14" fill="none">
          <circle cx="7" cy="7" r="3" stroke="currentColor" stroke-width="1.3" />
          <path d="M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13M3.05 3.05l1.06 1.06M9.89 9.89l1.06 1.06M3.05 10.95l1.06-1.06M9.89 4.11l1.06-1.06" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
        </svg>
        <svg v-else width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M11.5 8.5A5 5 0 015.5 2.5 5.5 5.5 0 1011.5 8.5z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" />
        </svg>
      </button>
    </div>
  </nav>
</template>

<style scoped>
.nav-rail {
  width: var(--nav-rail-width);
  height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  background: var(--bg-deep);
  border-right: 1px solid var(--border-subtle);
  padding: 12px 0;
  flex-shrink: 0;
  position: relative;
}

.nav-logo {
  font-family: var(--font-mono);
  font-size: 18px;
  font-weight: 700;
  color: var(--accent);
  opacity: 0.8;
  margin-bottom: 20px;
  user-select: none;
}

.nav-items {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.nav-item {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
  position: relative;
}
.nav-item:hover {
  background: var(--bg-hover);
  color: var(--text-secondary);
}
.nav-item.active {
  background: var(--accent-dim);
  color: var(--accent);
}
.nav-item.active::before {
  content: "";
  position: absolute;
  left: -6px;
  top: 8px;
  bottom: 8px;
  width: 2px;
  border-radius: 1px;
  background: var(--accent);
}

.nav-spacer {
  flex: 1;
}

.nav-bottom {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.connection-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-muted);
  margin-bottom: 4px;
}
.connection-dot.connected {
  background: var(--green);
  box-shadow: 0 0 6px var(--green-dim);
}
.connection-dot.connecting {
  background: var(--amber);
  animation: pulse 1.5s ease infinite;
}
.connection-dot.disconnected {
  background: var(--rose);
}

.nav-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
}
.nav-toggle:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-dim);
}

.locale-label {
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 600;
}
</style>
