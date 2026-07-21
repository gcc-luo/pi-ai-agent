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

const projectsCollapsed = ref(false);
const sessionsCollapsed = ref(false);
const filesCollapsed = ref(false);

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
    <!-- Projects Section -->
    <div class="sidebar-section" :class="{ collapsed: projectsCollapsed }">
      <div class="section-header">
        <button type="button" class="section-toggle" :aria-expanded="!projectsCollapsed" @click="projectsCollapsed = !projectsCollapsed">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" :class="{ rotated: projectsCollapsed }">
            <path d="M3 4.5l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span class="section-label">{{ t('sidebar.projects') }}</span>
          <span class="section-count">{{ projectStore.projects.length }}</span>
        </button>
        <button class="section-action" @click="showNewProject = true" :title="t('sidebar.newProject')">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 2v10M2 7h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </button>
      </div>

      <div class="section-list" v-show="!projectsCollapsed">
        <div
          v-for="p in projectStore.projects"
          :key="p.id"
          class="list-item"
          :class="{ active: p.id === selectedProjectId }"
          @click="emit('select-project', p.id)"
        >
          <span class="item-icon">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M1.5 3a1 1 0 011-1h3.586a1 1 0 01.707.293l1.414 1.414a1 1 0 00.707.293h3.586a1 1 0 011 1V11a1 1 0 01-1 1h-9a1 1 0 01-1-1V3z" stroke="currentColor" stroke-width="1.2"/>
            </svg>
          </span>
          <div class="item-content">
            <span class="item-label truncate">{{ p.name }}</span>
            <span class="item-path truncate">{{ p.workdir }}</span>
          </div>
          <span class="item-actions">
            <button class="item-action" :title="t('rename.title')" @click.stop="startRename(p)">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 10l1-3 5-5 2 2-5 5-3 1z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
              </svg>
            </button>
            <button class="item-action danger" :title="t('delete.confirmTitle')" @click.stop="startDelete(p)">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M3 3v7a1 1 0 001 1h4a1 1 0 001-1V3M2 3h8M5 3V2h2v1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </span>
        </div>
        <div v-if="!projectStore.projects.length" class="empty-hint">
          {{ t('sidebar.noProjects') }}
        </div>
      </div>
    </div>

    <!-- Sessions Section -->
    <div class="sidebar-section" :class="{ collapsed: sessionsCollapsed }" v-if="selectedProjectId">
      <div class="section-header">
        <button type="button" class="section-toggle" :aria-expanded="!sessionsCollapsed" @click="sessionsCollapsed = !sessionsCollapsed">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" :class="{ rotated: sessionsCollapsed }">
            <path d="M3 4.5l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span class="section-label">{{ t('sidebar.sessions') }}</span>
          <span class="section-count">{{ sessionStore.sessions.length }}</span>
        </button>
        <button class="section-action" @click="emit('create-session')" :title="t('sidebar.newSession')">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 2v10M2 7h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </button>
      </div>

      <div class="section-list" v-show="!sessionsCollapsed">
        <div
          v-for="s in sessionStore.sessions"
          :key="s.id"
          class="list-item"
          :class="{ active: s.id === selectedSessionId }"
          @click="emit('select-session', s.id)"
        >
          <span class="item-icon">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <rect x="1.5" y="2" width="11" height="10" rx="1.5" stroke="currentColor" stroke-width="1.2"/>
              <path d="M4 5h6M4 7.5h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
            </svg>
          </span>
          <div class="item-content">
            <span class="item-label truncate">{{ s.title ?? t('sidebar.newSession') }}</span>
          </div>
          <span v-if="agent.isSessionBusy(s.id)" class="status-dot running" />
          <span class="item-actions">
            <button class="item-action" :title="t('renameSession.title')" @click.stop="startRenameSession(s)">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 10l1-3 5-5 2 2-5 5-3 1z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
              </svg>
            </button>
            <button class="item-action danger" :title="t('deleteSession.confirmTitle')" @click.stop="startDeleteSession(s)">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M3 3v7a1 1 0 001 1h4a1 1 0 001-1V3M2 3h8M5 3V2h2v1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </span>
        </div>
        <div v-if="!sessionStore.sessions.length" class="empty-state">
          <span class="empty-text">{{ t('sidebar.noSessionsForProject') }}</span>
          <button class="empty-action" @click="emit('create-session')">{{ t('sidebar.newSession') }}</button>
        </div>
      </div>
    </div>

    <!-- Files Section -->
    <div class="sidebar-section sidebar-files" :class="{ collapsed: filesCollapsed }" v-if="selectedProjectId">
      <div class="section-header">
        <button type="button" class="section-toggle" :aria-expanded="!filesCollapsed" @click="filesCollapsed = !filesCollapsed">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" :class="{ rotated: filesCollapsed }">
            <path d="M3 4.5l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span class="section-label">{{ t('sidebar.files') }}</span>
        </button>
        <div class="section-actions">
          <button class="section-action" @click="fileTreeRef?.startCreate()" :title="t('file.new')">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 2v10M2 7h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
      </div>

      <div class="files-tree" v-show="!filesCollapsed">
        <FileTree ref="fileTreeRef" :project-id="selectedProjectId" @select="emit('select-file', $event)" />
      </div>
    </div>

    <!-- Dialogs -->
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
  background: var(--background-panel);
  border-right: 1px solid var(--border-color);
  overflow: hidden;
  flex-shrink: 0;
}

/* ─── Sections ─── */

.sidebar-section {
  display: flex;
  flex-direction: column;
  flex: 1 1 0;
  min-height: 0;
  border-bottom: 1px solid var(--border-color);
}
.sidebar-section.collapsed {
  flex: 0 0 auto;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  flex-shrink: 0;
}

.section-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
  padding: 0;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.section-toggle:hover .section-label {
  color: var(--text-primary);
}

.section-toggle svg {
  transition: transform var(--transition-fast);
  color: var(--text-secondary);
}
.section-toggle svg.rotated {
  transform: rotate(-90deg);
}

.section-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.section-count {
  font-size: 11px;
  font-weight: 500;
  line-height: 16px;
  min-width: 18px;
  padding: 0 6px;
  text-align: center;
  color: var(--text-secondary);
  background: var(--background-page);
  border-radius: 999px;
}

.section-action {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);
}
.section-action:hover {
  background: var(--background-hover);
  color: var(--primary-color);
}

.section-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

/* ─── List Items ─── */

.section-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 8px 8px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}

.list-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--radius-md);
  cursor: pointer;
  position: relative;
  transition: background var(--transition-fast);
}
.list-item:hover {
  background: var(--background-hover);
}
.list-item.active {
  background: var(--background-selected);
}
.list-item.active::before {
  content: "";
  position: absolute;
  left: 0;
  top: 6px;
  bottom: 6px;
  width: 3px;
  border-radius: 2px;
  background: var(--primary-color);
}

.item-icon {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  color: var(--text-secondary);
}
.list-item.active .item-icon {
  color: var(--primary-color);
}

.item-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.item-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}
.list-item.active .item-label {
  color: var(--primary-color);
  font-weight: 600;
}

.item-path {
  font-size: 11px;
  color: var(--text-secondary);
}

.item-actions {
  display: flex;
  align-items: center;
  gap: 2px;
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
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);
}
.item-action:hover {
  background: var(--background-hover);
  color: var(--text-primary);
}
.item-action.danger:hover {
  background: rgba(239, 68, 68, 0.10);
  color: var(--danger-color);
}

/* ─── Status Dot ─── */

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}
.status-dot.running {
  background: var(--primary-color);
  animation: pulse 1.5s ease infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

/* ─── Empty State ─── */

.empty-hint {
  padding: 12px 10px;
  font-size: 12px;
  color: var(--text-secondary);
  text-align: center;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 16px 10px;
}

.empty-text {
  font-size: 12px;
  color: var(--text-secondary);
}

.empty-action {
  padding: 6px 16px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-color);
  background: var(--background-panel);
  color: var(--primary-color);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition-fast);
}
.empty-action:hover {
  border-color: var(--primary-color);
  background: var(--primary-light);
}

/* ─── Files Section ─── */

.sidebar-files {
  flex: 2 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.sidebar-files.collapsed {
  flex: 0 0 auto;
}

.files-tree {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0 8px 8px;
}
</style>
