<script setup lang="ts">
import { ref } from "vue";
import { useProjectStore } from "../stores/project.js";
import { useSessionStore } from "../stores/session.js";
import { useAgentStore } from "../stores/agent.js";
import FileTree from "./FileTree.vue";
import NewProjectDialog from "./NewProjectDialog.vue";
import RenameProjectDialog from "./RenameProjectDialog.vue";
import RenameSessionDialog from "./RenameSessionDialog.vue";
import ConfirmDialog from "./ConfirmDialog.vue";
import { useI18n } from "../i18n/index.js";
import type { ProjectDto, SessionDto } from "@pi-web-ui/shared";

const projectStore = useProjectStore();
const sessionStore = useSessionStore();
const agent = useAgentStore();
const { t } = useI18n();

const fileTreeRef = ref<InstanceType<typeof FileTree> | null>(null);

const props = defineProps<{
  selectedProjectId: string | null;
  selectedSessionId: string | null;
}>();

const emit = defineEmits<{
  (e: "select-project", id: string): void;
  (e: "select-session", id: string): void;
  (e: "create-project", name: string, workdir: string): void;
  (e: "rename-project", id: string, name: string): void;
  (e: "delete-project", id: string): void;
  (e: "create-session"): void;
  (e: "rename-session", id: string, title: string): void;
  (e: "delete-session", id: string): void;
  (e: "select-file", path: string): void;
}>();

const showNewProject = ref(false);
const renameTarget = ref<ProjectDto | null>(null);
const deleteTarget = ref<ProjectDto | null>(null);
const renameSessionTarget = ref<SessionDto | null>(null);
const deleteSessionTarget = ref<SessionDto | null>(null);

function handleCreateProject(name: string, workdir: string) {
  emit("create-project", name, workdir);
  showNewProject.value = false;
}

function startRename(p: ProjectDto) {
  renameTarget.value = p;
}

function startDelete(p: ProjectDto) {
  deleteTarget.value = p;
}

function startRenameSession(s: SessionDto) {
  renameSessionTarget.value = s;
}

function startDeleteSession(s: SessionDto) {
  deleteSessionTarget.value = s;
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
        <button class="section-action" @click="showNewProject = true" :title="t('sidebar.newProject')">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
        </button>
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
          <span class="item-actions">
            <button
              class="item-action"
              :title="t('rename.title')"
              @click.stop="startRename(p)"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 10l1-3 5-5 2 2-5 5-3 1z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" />
              </svg>
            </button>
            <button
              class="item-action danger"
              :title="t('delete.confirmTitle')"
              @click.stop="startDelete(p)"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M3 3v7a1 1 0 001 1h4a1 1 0 001-1V3M2 3h8M5 3V2h2v1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
          </span>
        </div>
        <div v-if="!projectStore.projects.length" class="empty-hint">
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
          <span class="item-label truncate">{{ s.title ?? t('sidebar.newSession') }}</span>
          <span v-if="agent.isSessionBusy(s.id)" class="session-spinner" :title="t('chat.toolRunning')" />
          <span v-else class="session-status-dot" :class="s.status" />
          <span class="item-actions">
            <button
              class="item-action"
              :title="t('renameSession.title')"
              @click.stop="startRenameSession(s)"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 10l1-3 5-5 2 2-5 5-3 1z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" />
              </svg>
            </button>
            <button
              class="item-action danger"
              :title="t('deleteSession.confirmTitle')"
              @click.stop="startDeleteSession(s)"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M3 3v7a1 1 0 001 1h4a1 1 0 001-1V3M2 3h8M5 3V2h2v1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
          </span>
        </div>
        <div v-if="!sessionStore.sessions.length" class="empty-hint">
          {{ t('sidebar.noSessions') }}
        </div>
      </div>
    </div>

    <!-- Files -->
    <div class="sidebar-section sidebar-files" v-if="selectedProjectId">
      <div class="section-header">
        <span class="section-label">{{ t('header.files') }}</span>
        <button class="section-action" @click="fileTreeRef?.startCreate()" :title="t('file.new')">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
        </button>
      </div>
      <div class="files-tree">
        <FileTree ref="fileTreeRef" :project-id="selectedProjectId" @select="emit('select-file', $event)" />
      </div>
    </div>

    <!-- New Project Dialog -->
    <NewProjectDialog
      :show="showNewProject"
      @close="showNewProject = false"
      @create="handleCreateProject"
    />

    <RenameProjectDialog
      :show="renameTarget !== null"
      :project="renameTarget"
      @close="renameTarget = null"
      @rename="(id, name) => emit('rename-project', id, name)"
    />

    <ConfirmDialog
      :show="deleteTarget !== null"
      :title="t('delete.confirmTitle')"
      :message="t('delete.confirmMessage')"
      :confirm-label="t('delete.confirm')"
      :cancel-label="t('delete.cancel')"
      :danger="true"
      @close="deleteTarget = null"
      @confirm="emit('delete-project', deleteTarget!.id)"
    />

    <RenameSessionDialog
      :show="renameSessionTarget !== null"
      :session="renameSessionTarget"
      @close="renameSessionTarget = null"
      @rename="(id, title) => emit('rename-session', id, title)"
    />

    <ConfirmDialog
      :show="deleteSessionTarget !== null"
      :title="t('deleteSession.confirmTitle')"
      :message="t('deleteSession.confirmMessage')"
      :confirm-label="t('deleteSession.confirm')"
      :cancel-label="t('deleteSession.cancel')"
      :danger="true"
      @close="deleteSessionTarget = null"
      @confirm="emit('delete-session', deleteSessionTarget!.id)"
    />
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
  display: flex;
  flex-direction: column;
  max-height: 200px;
  min-height: 0;
  position: relative;
  padding: 12px 0 4px;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 12px;
  margin: 0 6px 6px;
  flex-shrink: 0;
  background: var(--bg-hover);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
}

.section-label {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--text-secondary);
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
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
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

.item-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity var(--transition-fast);
}
.list-item:hover .item-actions,
.list-item:focus-within .item-actions {
  opacity: 1;
}
.item-action {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
}
.item-action:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.item-action.danger:hover {
  background: var(--rose-dim, rgba(244, 63, 94, 0.15));
  color: var(--rose);
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

/* Animated spinner — replaces the status dot while a session is producing
   output. Sits at the same position so the row's layout doesn't shift. */
.session-spinner {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  border: 1.5px solid var(--accent-dim);
  border-top-color: var(--accent);
  margin-left: auto;
  flex-shrink: 0;
  animation: sessionSpin 0.7s linear infinite;
}

@keyframes sessionSpin {
  to { transform: rotate(360deg); }
}

/* ─── Empty Hints ─── */

.empty-hint {
  padding: 6px 10px;
  font-size: 11px;
  color: var(--text-faint);
  font-style: italic;
}

/* ─── Files Section ─── */

.sidebar-files {
  flex: 1;
  min-height: 0;
  max-height: none;
  display: flex;
  flex-direction: column;
}

.files-tree {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0 6px;
}
</style>
