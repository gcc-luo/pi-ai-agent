<script setup lang="ts">
import { ref, computed, reactive, onMounted, onBeforeUnmount } from "vue";
import { api } from "../api/client.js";
import { useProjectStore } from "../stores/project.js";
import { useSessionStore } from "../stores/session.js";
import { useAgentStore } from "../stores/agent.js";
import FileTree from "./FileTree.vue";
import RenameSessionDialog from "./RenameSessionDialog.vue";
import ProjectManagerDialog from "./ProjectManagerDialog.vue";
import ConfirmDialog from "./ConfirmDialog.vue";
import { useI18n } from "../i18n/index.js";
import { renderMarkdown } from "../utils/markdown.js";
import type { SessionDto, MessageDto } from "@pi-web-ui/shared";

const projectStore = useProjectStore();
const sessionStore = useSessionStore();
const agent = useAgentStore();
const { t } = useI18n();

const fileTreeRef = ref<InstanceType<typeof FileTree> | null>(null);
const isRefreshingFiles = ref(false);

const showProjectDropdown = ref(false);
const showProjectManager = ref(false);
const sessionsCollapsed = ref(false);
const filesCollapsed = ref(false);

const props = defineProps<{
  selectedProjectId: string | null;
  selectedSessionId: string | null;
}>();

const emit = defineEmits<{
  (e: "select-project", id: string): void;
  (e: "select-session", id: string): void;
  (e: "create-session"): void;
  (e: "rename-session", id: string, title: string): void;
  (e: "delete-session", id: string): void;
  (e: "select-file", path: string): void;
}>();

const renameSessionTarget = ref<SessionDto | null>(null);
const deleteSessionTarget = ref<SessionDto | null>(null);

async function refreshFiles() {
  if (isRefreshingFiles.value) return;
  isRefreshingFiles.value = true;
  try {
    await fileTreeRef.value?.refresh();
  } finally {
    isRefreshingFiles.value = false;
  }
}

// Search
const sessionQuery = ref("");

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

onMounted(() => {
  document.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (!target.closest(".project-selector")) {
      showProjectDropdown.value = false;
    }
  });
});

function selectProject(id: string) {
  emit("select-project", id);
  showProjectDropdown.value = false;
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
    <!-- Project Selector -->
    <div class="sidebar-project">
      <div class="project-selector">
        <button class="project-selector-btn" @click="showProjectDropdown = !showProjectDropdown">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M1.5 3a1 1 0 011-1h3.586a1 1 0 01.707.293l1.414 1.414a1 1 0 00.707.293h3.586a1 1 0 011 1V11a1 1 0 01-1 1h-9a1 1 0 01-1-1V3z" stroke="currentColor" stroke-width="1.2"/>
          </svg>
          <span class="project-selector-name">{{ projectStore.current?.name ?? t('sidebar.selectProject') }}</span>
          <svg class="project-selector-chevron" :class="{ open: showProjectDropdown }" width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M3 4.5l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <div v-if="showProjectDropdown" class="project-dropdown" @click.stop>
          <div
            v-for="p in projectStore.projects"
            :key="p.id"
            class="project-dropdown-item"
            :class="{ active: p.id === selectedProjectId }"
            @click="selectProject(p.id)"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M1.5 3a1 1 0 011-1h3.586a1 1 0 01.707.293l1.414 1.414a1 1 0 00.707.293h3.586a1 1 0 011 1V11a1 1 0 01-1 1h-9a1 1 0 01-1-1V3z" stroke="currentColor" stroke-width="1.2"/>
            </svg>
            <span class="project-dropdown-name">{{ p.name }}</span>
          </div>
          <div class="project-dropdown-footer">
            <button class="project-dropdown-manage" @click="showProjectManager = true; showProjectDropdown = false">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M7 2v10M2 7h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              </svg>
              <span>{{ t('sidebar.manageProjects') }}</span>
            </button>
          </div>
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
          <button
            class="section-action section-action-refresh"
            :class="{ refreshing: isRefreshingFiles }"
            :disabled="isRefreshingFiles"
            :aria-label="t('file.refresh')"
            :title="t('file.refresh')"
            @click="refreshFiles"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M13.35 6.2A5.35 5.35 0 0 0 4.05 4.1L2.8 5.35" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M2.8 2.85v2.5h2.5" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M2.65 9.8a5.35 5.35 0 0 0 9.3 2.1l1.25-1.25" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M13.2 13.15v-2.5h-2.5" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"/>
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

    <ProjectManagerDialog
      :show="showProjectManager"
      @close="showProjectManager = false"
      @select="selectProject($event)"
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


/* ─── Project Selector ─── */

.sidebar-project {
  padding: 10px 12px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--border-color);
}

.project-selector {
  position: relative;
}

.project-selector-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
  transition: all var(--transition-fast);
  font-family: var(--font-mono);
}
.project-selector-btn:hover {
  background: var(--bg-hover);
  border-color: var(--border-default);
}

.project-selector-name {
  flex: 1;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: -0.01em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
}

.project-selector-chevron {
  flex-shrink: 0;
  transition: transform var(--transition-fast);
  color: var(--text-muted);
}
.project-selector-chevron.open {
  transform: rotate(180deg);
}

.project-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  min-width: 0;
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg, 0 8px 24px rgba(0, 0, 0, 0.12));
  z-index: 100;
  overflow: hidden;
}

.project-dropdown-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  transition: background var(--transition-fast);
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 13px;
}
.project-dropdown-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.project-dropdown-item.active {
  background: var(--accent-dim);
  color: var(--accent);
}

.project-dropdown-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-dropdown-footer {
  border-top: 1px solid var(--border-subtle);
  padding: 4px;
}

.project-dropdown-manage {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--transition-fast);
}
.project-dropdown-manage:hover {
  background: var(--bg-hover);
  color: var(--accent);
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
  width: 28px;
  height: 28px;
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

.section-action-refresh {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  box-shadow: none;
}
.section-action-refresh:hover {
  border-color: transparent;
  background: var(--background-hover);
  color: var(--primary-color);
  box-shadow: none;
}
.section-action-refresh:active:not(:disabled) {
  transform: scale(0.94);
  box-shadow: none;
}
.section-action-refresh:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.section-action-refresh:disabled {
  cursor: wait;
  opacity: 0.72;
}
.section-action-refresh.refreshing svg {
  animation: sidebar-refresh-spin 0.8s linear infinite;
}

@keyframes sidebar-refresh-spin {
  to { transform: rotate(360deg); }
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
