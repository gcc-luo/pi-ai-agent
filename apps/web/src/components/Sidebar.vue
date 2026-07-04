<script setup lang="ts">
import { ref } from "vue";
import { NInput, NButton } from "naive-ui";
import { useProjectStore } from "../stores/project.js";
import { useSessionStore } from "../stores/session.js";
import { useI18n } from "../i18n/index.js";

const projectStore = useProjectStore();
const sessionStore = useSessionStore();
const { t } = useI18n();

const props = defineProps<{
  selectedProjectId: string | null;
  selectedSessionId: string | null;
}>();

const emit = defineEmits<{
  (e: "select-project", id: string): void;
  (e: "select-session", id: string): void;
  (e: "create-project", name: string): void;
  (e: "create-session"): void;
}>();

const showNewProject = ref(false);
const newProjectName = ref("");

function handleCreateProject() {
  const name = newProjectName.value.trim();
  if (!name) return;
  emit("create-project", name);
  newProjectName.value = "";
  showNewProject.value = false;
}

function handleKeyCreate(e: KeyboardEvent) {
  if (e.key === "Enter") handleCreateProject();
  if (e.key === "Escape") {
    showNewProject.value = false;
    newProjectName.value = "";
  }
}
</script>

<template>
  <aside class="sidebar">
    <!-- Brand -->
    <div class="sidebar-brand">
      <span class="brand-symbol">π</span>
      <div class="brand-text">
        <span class="brand-name">PI</span>
        <span class="brand-sub">{{ t('brand.sub') }}</span>
      </div>
    </div>

    <!-- Projects -->
    <div class="sidebar-section">
      <div class="section-header">
        <span class="section-label">{{ t('sidebar.projects') }}</span>
        <button class="section-action" @click="showNewProject = !showNewProject" :title="t('sidebar.newProject')">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
        </button>
      </div>

      <!-- New project input -->
      <div v-if="showNewProject" class="new-project-input">
        <NInput
          v-model:value="newProjectName"
          size="small"
          :placeholder="t('sidebar.projectPlaceholder')"
          :autosize="false"
          @keydown="handleKeyCreate"
          autofocus
        />
      </div>

      <div class="section-list">
        <div
          v-for="p in projectStore.projects"
          :key="p.id"
          class="list-item"
          :class="{ active: p.id === selectedProjectId }"
          @click="emit('select-project', p.id)"
        >
          <span class="item-icon">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M1.5 3a1 1 0 011-1h3.586a1 1 0 01.707.293l1.414 1.414a1 1 0 00.707.293h3.586a1 1 0 011 1V11a1 1 0 01-1 1h-9a1 1 0 01-1-1V3z"
                stroke="currentColor"
                stroke-width="1.2"
              />
            </svg>
          </span>
          <span class="item-label truncate">{{ p.name }}</span>
        </div>
        <div v-if="!projectStore.projects.length && !showNewProject" class="empty-hint">
          {{ t('sidebar.noProjects') }}
        </div>
      </div>
    </div>

    <!-- Sessions -->
    <div class="sidebar-section" v-if="selectedProjectId">
      <div class="section-header">
        <span class="section-label">{{ t('sidebar.sessions') }}</span>
        <button class="section-action" @click="emit('create-session')" :title="t('sidebar.newSession')">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
        </button>
      </div>
      <div class="section-list">
        <div
          v-for="s in sessionStore.sessions"
          :key="s.id"
          class="list-item"
          :class="{ active: s.id === selectedSessionId }"
          @click="emit('select-session', s.id)"
        >
          <span class="item-icon">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <rect x="1.5" y="2" width="11" height="10" rx="1.5" stroke="currentColor" stroke-width="1.2" />
              <path d="M4 5h6M4 7.5h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
            </svg>
          </span>
          <span class="item-label truncate">{{ s.title ?? s.id.slice(0, 8) }}</span>
          <span class="session-status-dot" :class="s.status" />
        </div>
        <div v-if="!sessionStore.sessions.length" class="empty-hint">
          {{ t('sidebar.noSessions') }}
        </div>
      </div>
    </div>

    <!-- Spacer -->
    <div class="sidebar-spacer" />

    <!-- Footer (minimal) -->
    <div class="sidebar-footer" />
  </aside>
</template>

<style scoped>
.sidebar {
  width: var(--sidebar-width);
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-deep);
  overflow: hidden;
  position: relative;
  flex-shrink: 0;
}

.sidebar::before {
  content: "";
  position: absolute;
  inset: 0;
  background-image:
    radial-gradient(circle at 1px 1px, rgba(255, 255, 255, 0.015) 1px, transparent 0);
  background-size: 24px 24px;
  pointer-events: none;
}

/* ─── Brand ─── */

.sidebar-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 18px 16px 14px;
  border-bottom: 1px solid var(--border-subtle);
  position: relative;
}

.brand-symbol {
  font-family: var(--font-mono);
  font-size: 22px;
  font-weight: 700;
  color: var(--accent);
  line-height: 1;
  opacity: 0.8;
}

.brand-text {
  display: flex;
  flex-direction: column;
}

.brand-name {
  font-family: var(--font-mono);
  font-size: 14px;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: 0.08em;
}

.brand-sub {
  font-size: 10px;
  color: var(--text-faint);
  letter-spacing: 0.02em;
}

/* ─── Sections ─── */

.sidebar-section {
  padding: 12px 0 4px;
  position: relative;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 14px 6px;
}

.section-label {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--text-faint);
}

.section-action {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: 1px dashed var(--border-active);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
}
.section-action:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-dim);
}

/* ─── List Items ─── */

.section-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 0 6px;
}

.list-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all var(--transition-fast);
  position: relative;
}
.list-item:hover {
  background: var(--bg-hover);
}
.list-item.active {
  background: var(--accent-dim);
}
.list-item.active::before {
  content: "";
  position: absolute;
  left: 0;
  top: 4px;
  bottom: 4px;
  width: 2px;
  border-radius: 1px;
  background: var(--accent);
}

.list-item.active .item-label {
  color: var(--text-primary);
}

.item-icon {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  color: var(--text-muted);
}
.list-item.active .item-icon {
  color: var(--accent);
}
.list-item:hover .item-icon {
  color: var(--text-secondary);
}

.item-label {
  font-size: 13px;
  color: var(--text-secondary);
  transition: color var(--transition-fast);
}
.list-item:hover .item-label {
  color: var(--text-primary);
}

/* ─── Session Status Dot ─── */

.session-status-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--text-faint);
  margin-left: auto;
  flex-shrink: 0;
}
.session-status-dot.active {
  background: var(--green);
  box-shadow: 0 0 6px var(--green-dim);
}
.session-status-dot.idle {
  background: var(--amber);
}
.session-status-dot.suspended {
  background: var(--text-faint);
}
.session-status-dot.crashed {
  background: var(--rose);
}

/* ─── New Project Input ─── */

.new-project-input {
  padding: 0 10px 6px;
  animation: fadeInFast 0.15s var(--ease-out);
}

/* ─── Empty Hints ─── */

.empty-hint {
  padding: 6px 10px;
  font-size: 11px;
  color: var(--text-faint);
  font-style: italic;
}

/* ─── Spacer ─── */

.sidebar-spacer {
  flex: 1;
}

/* ─── Footer ─── */

.sidebar-footer {
  padding: 0;
  border-top: 1px solid var(--border-subtle);
}
</style>
