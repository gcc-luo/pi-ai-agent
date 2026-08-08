<script setup lang="ts">
import { ref, computed, reactive, onBeforeUnmount } from "vue";
import { api } from "../api/client.js";
import { useProjectStore } from "../stores/project.js";
import { useSessionStore } from "../stores/session.js";
import { useAgentStore } from "../stores/agent.js";
import FileTree from "./FileTree.vue";
import NewProjectDialog from "./NewProjectDialog.vue";
import RenameProjectDialog from "./RenameProjectDialog.vue";
import RenameSessionDialog from "./RenameSessionDialog.vue";
import ConfirmDialog from "./ConfirmDialog.vue";
import { useI18n } from "../i18n/index.js";
import { renderMarkdown } from "../utils/markdown.js";
import type { ProjectDto, SessionDto, MessageDto } from "@pi-web-ui/shared";

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

// Search
const projectQuery = ref("");
const sessionQuery = ref("");

const filteredProjects = computed(() => {
  const q = projectQuery.value.trim().toLowerCase();
  if (!q) return projectStore.projects;
  return projectStore.projects.filter(
    (p) => p.name.toLowerCase().includes(q) || p.workdir.toLowerCase().includes(q)
  );
});

const filteredSessions = computed(() => {
  const q = sessionQuery.value.trim().toLowerCase();
  if (!q) return sessionStore.sessions;
  return sessionStore.sessions.filter((s) => (s.title ?? "").toLowerCase().includes(q));
});

type SessionPreviewState = {
  status: "loading" | "ready" | "empty" | "error";
  content: string;
};

const previewCache = reactive<Record<string, SessionPreviewState>>({});
const previewSessionId = ref<string | null>(null);
const previewAnchorRect = ref<DOMRect | null>(null);
const previewCardHovered = ref(false);
let previewHideTimer: ReturnType<typeof setTimeout> | undefined;

const previewSession = computed(() =>
  sessionStore.sessions.find((session) => session.id === previewSessionId.value) ?? null,
);
const previewState = computed(() =>
  previewSessionId.value ? previewCache[previewSessionId.value] ?? null : null,
);
const previewVisible = computed(() => Boolean(previewSession.value && previewAnchorRect.value));
const previewStyle = computed(() => {
  const rect = previewAnchorRect.value;
  if (!rect) return {};

  const cardWidth = Math.min(310, Math.max(220, window.innerWidth - 24));
  let left = rect.right + 12;
  if (left + cardWidth > window.innerWidth - 12) {
    left = Math.max(12, window.innerWidth - cardWidth - 12);
  }

  const cardHeight = 160;
  const top = Math.min(Math.max(12, rect.top - 4), Math.max(12, window.innerHeight - cardHeight - 12));
  return {
    left: `${left}px`,
    top: `${top}px`,
    width: `${cardWidth}px`,
  };
});

function clearPreviewHideTimer() {
  if (previewHideTimer) {
    clearTimeout(previewHideTimer);
    previewHideTimer = undefined;
  }
}

function normalizePreviewContent(content: string): string {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  return normalized.length > 360 ? `${normalized.slice(0, 360).trimEnd()}…` : normalized;
}

function latestPreviewMessage(messages: MessageDto[]): MessageDto | null {
  return [...messages]
    .reverse()
    .find((message) => (message.role === "user" || message.role === "assistant") && message.content?.trim()) ?? null;
}

async function loadSessionPreview(sessionId: string) {
  const existing = previewCache[sessionId];
  if (existing && existing.status !== "error") return;

  previewCache[sessionId] = { status: "loading", content: "" };
  try {
    const message = latestPreviewMessage(await api.listMessages(sessionId));
    previewCache[sessionId] = message
      ? { status: "ready", content: normalizePreviewContent(message.content ?? "") }
      : { status: "empty", content: "" };
  } catch {
    previewCache[sessionId] = { status: "error", content: "" };
  }
}

function showSessionPreview(session: SessionDto, event: Event) {
  const anchor = event.currentTarget;
  if (!(anchor instanceof HTMLElement)) return;

  clearPreviewHideTimer();
  previewCardHovered.value = false;
  previewSessionId.value = session.id;
  previewAnchorRect.value = anchor.getBoundingClientRect();
  void loadSessionPreview(session.id);
}

function hideSessionPreview() {
  clearPreviewHideTimer();
  previewHideTimer = setTimeout(() => {
    if (previewCardHovered.value) return;
    previewSessionId.value = null;
    previewAnchorRect.value = null;
  }, 140);
}

function enterPreviewCard() {
  clearPreviewHideTimer();
  previewCardHovered.value = true;
}

function leavePreviewCard() {
  previewCardHovered.value = false;
  hideSessionPreview();
}

onBeforeUnmount(clearPreviewHideTimer);

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

      <div v-if="projectStore.projects.length > 3 && !projectsCollapsed" class="section-search">
        <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
          <circle cx="6" cy="6" r="4" stroke="currentColor" stroke-width="1.2"/>
          <path d="M9 9l3.5 3.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
        </svg>
        <input
          v-model="projectQuery"
          type="text"
          class="section-search-input"
          :placeholder="t('sidebar.searchProjects')"
        />
      </div>

      <div class="section-list" v-show="!projectsCollapsed">
        <div
          v-for="p in filteredProjects"
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
        <div v-else-if="!filteredProjects.length" class="empty-hint">
          {{ t('sidebar.noResults') }}
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

      <div v-if="sessionStore.sessions.length > 3 && !sessionsCollapsed" class="section-search">
        <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
          <circle cx="6" cy="6" r="4" stroke="currentColor" stroke-width="1.2"/>
          <path d="M9 9l3.5 3.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
        </svg>
        <input
          v-model="sessionQuery"
          type="text"
          class="section-search-input"
          :placeholder="t('sidebar.searchSessions')"
        />
      </div>

      <div class="section-list" v-show="!sessionsCollapsed">
        <div
          v-for="s in filteredSessions"
          :key="s.id"
          class="list-item"
          :class="{ active: s.id === selectedSessionId }"
          role="button"
          tabindex="0"
          :aria-label="s.title ?? t('sidebar.newSession')"
          @mouseenter="showSessionPreview(s, $event)"
          @mouseleave="hideSessionPreview"
          @focusin="showSessionPreview(s, $event)"
          @focusout="hideSessionPreview"
          @keydown.enter.stop.prevent="emit('select-session', s.id)"
          @keydown.space.stop.prevent="emit('select-session', s.id)"
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
        <div v-else-if="!filteredSessions.length" class="empty-hint">
          {{ t('sidebar.noResults') }}
        </div>
      </div>
    </div>

    <Teleport to="body">
      <div
        v-if="previewVisible"
        class="session-preview"
        :style="previewStyle"
        role="tooltip"
        @mouseenter="enterPreviewCard"
        @mouseleave="leavePreviewCard"
      >
        <div class="session-preview-title truncate">
          {{ previewSession?.title ?? t('sidebar.newSession') }}
        </div>
        <div class="session-preview-content">
          <span v-if="previewState?.status === 'loading'" class="session-preview-muted">
            {{ t('sidebar.previewLoading') }}
          </span>
          <span v-else-if="previewState?.status === 'empty'" class="session-preview-muted">
            {{ t('sidebar.previewEmpty') }}
          </span>
          <span v-else-if="previewState?.status === 'error'" class="session-preview-muted">
            {{ t('sidebar.previewError') }}
          </span>
          <div
            v-else
            class="session-preview-message"
            v-html="renderMarkdown(previewState?.content ?? '')"
          />
        </div>
      </div>
    </Teleport>

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
          <button class="section-action" @click="fileTreeRef?.refresh()" :title="t('file.refresh')">
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
              <path d="M11.5 7A4.5 4.5 0 1 1 10 3.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
              <path d="M10 1v3h3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
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

/* ─── Search ─── */

.section-search {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  margin: 0 8px;
  border-radius: var(--radius-sm);
  background: var(--background-hover);
  color: var(--text-secondary);
  flex-shrink: 0;
}
.section-search svg {
  flex-shrink: 0;
  opacity: 0.5;
}
.section-search-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 12px;
  line-height: 1.4;
}
.section-search-input::placeholder {
  color: var(--text-secondary);
  opacity: 0.6;
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
.list-item:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: -2px;
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

/* ─── Session History Preview ─── */

.session-preview {
  position: fixed;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 160px;
  padding: 12px;
  overflow: hidden;
  border: 1px solid var(--border-active);
  border-radius: 12px;
  background: var(--bg-elevated);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.22), 0 4px 14px rgba(0, 0, 0, 0.12);
  color: var(--text-primary);
  pointer-events: auto;
  animation: session-preview-in 140ms var(--ease-out);
}

.session-preview-title {
  flex-shrink: 0;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.35;
}

.session-preview-content {
  min-height: 0;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 1.45;
}

.session-preview-message {
  display: block;
  max-height: 104px;
  overflow: hidden;
  overflow-wrap: anywhere;
}

.session-preview-message :deep(p) {
  margin: 0 0 5px;
}

.session-preview-message :deep(p:last-child) {
  margin-bottom: 0;
}

.session-preview-message :deep(h1),
.session-preview-message :deep(h2),
.session-preview-message :deep(h3),
.session-preview-message :deep(h4),
.session-preview-message :deep(h5),
.session-preview-message :deep(h6) {
  margin: 0 0 5px;
  color: var(--text-primary);
  font-size: 1.08em;
  font-weight: 600;
  line-height: 1.35;
}

.session-preview-message :deep(ul),
.session-preview-message :deep(ol) {
  margin: 3px 0 6px;
  padding-left: 18px;
}

.session-preview-message :deep(li) {
  margin: 1px 0;
}

.session-preview-message :deep(blockquote) {
  margin: 4px 0;
  padding-left: 7px;
  border-left: 2px solid var(--border-active);
  color: var(--text-muted);
}

.session-preview-message :deep(code) {
  padding: 1px 3px;
  border-radius: 3px;
  background: var(--bg-surface);
  font-family: var(--font-mono);
  font-size: 0.95em;
}

.session-preview-message :deep(pre) {
  margin: 4px 0;
  padding: 6px;
  overflow: hidden;
  border-radius: 5px;
  background: var(--bg-surface);
  white-space: pre-wrap;
}

.session-preview-message :deep(pre code) {
  padding: 0;
  background: transparent;
}

.session-preview-message :deep(.code-copy-btn) {
  display: none;
}

.session-preview-message :deep(a) {
  color: var(--accent);
}

.session-preview-message :deep(hr) {
  height: 1px;
  margin: 5px 0;
  border: 0;
  background: var(--border-default);
}

.session-preview-message :deep(table) {
  max-width: 100%;
  border-collapse: collapse;
  font-size: 10px;
}

.session-preview-message :deep(th),
.session-preview-message :deep(td) {
  padding: 2px 4px;
  border: 1px solid var(--border-default);
}

.session-preview-muted {
  color: var(--text-secondary);
  opacity: 0.75;
}

@keyframes session-preview-in {
  from {
    opacity: 0;
    transform: translateY(4px) scale(0.99);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
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
