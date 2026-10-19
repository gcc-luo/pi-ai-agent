<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick, defineAsyncComponent } from "vue";
import type { Component, ComponentPublicInstance } from "vue";
import { NConfigProvider, NSelect, NMessageProvider, darkTheme, zhCN, enUS, dateZhCN, dateEnUS, createDiscreteApi } from "naive-ui";
import Sidebar from "./components/Sidebar.vue";
import ChatPanel from "./components/ChatPanel.vue";
import WorkspaceToolPanel from "./components/WorkspaceToolPanel.vue";
const WorkspaceFileBrowser = defineAsyncComponent(() => import("./components/WorkspaceFileBrowser.vue"));
const WorkspacePreviewTab = defineAsyncComponent(() => import("./components/WorkspacePreviewTab.vue"));
// Lazy-loaded so the whole preview pipeline (highlight.js, mammoth, xlsx and
// the 10 preview SFCs) lives in its own chunk and never lands in the main
// bundle for users who only browse the chat.
import NavRail from "./components/NavRail.vue";
import ModelPanel from "./components/ModelPanel.vue";
import NewProjectDialog from "./components/NewProjectDialog.vue";
const SkillStoreView = defineAsyncComponent(() => import("./components/SkillStoreView.vue"));
const KnowledgeBaseView = defineAsyncComponent(() => import("./components/KnowledgeBaseView.vue"));
const TrashView = defineAsyncComponent(() => import("./components/TrashView.vue"));
const ExpertView = defineAsyncComponent(() => import("./components/ExpertView.vue"));
const ScheduledTasksView = defineAsyncComponent(() => import("./components/ScheduledTasksView.vue"));
const ChannelView = defineAsyncComponent(() => import("./components/ChannelView.vue"));
const PluginManagerView = defineAsyncComponent(() => import("./components/PluginManagerView.vue"));
const ConnectorView = defineAsyncComponent(() => import("./components/ConnectorView.vue"));
import { useProjectStore } from "./stores/project.js";
import { useSessionStore } from "./stores/session.js";
import { useConnectionStore } from "./stores/connection.js";
import { useAgentStore } from "./stores/agent.js";
import { useTrashStore } from "./stores/trash.js";
import { useThemeStore } from "./stores/theme.js";
import { useNotificationStore } from "./stores/notifications.js";
import { useWorkspaceToolsStore, type WorkspaceToolKind } from "./stores/workspace-tools.js";
import type { NotificationNavigationTarget } from "./stores/desktop.js";
import { useI18n } from "./i18n/index.js";
import { clampSidebarWidth, getSidebarMaxWidth, SIDEBAR_MIN_WIDTH } from "./utils/sidebar-width.js";
import { clampPreviewWidth, getPreviewMaxWidth, PREVIEW_MIN_WIDTH } from "./utils/preview-width.js";
import type { KbCitationMeta } from "./utils/kb-context.js";

const projectStore = useProjectStore();
const sessionStore = useSessionStore();
const connection = useConnectionStore();
const agent = useAgentStore();
const trashStore = useTrashStore();
const { message } = createDiscreteApi(["message"]);
const themeStore = useThemeStore();
const notifications = useNotificationStore();
const workspaceTools = useWorkspaceToolsStore();
const { t, currentLocale } = useI18n();

const selectedProjectId = ref<string | null>(null);
const selectedSessionId = ref<string | null>(null);
const workspaceToolComponents: Partial<Record<WorkspaceToolKind, Component>> = {
  files: WorkspaceFileBrowser,
};
const sidebarWidth = ref(320);
const sidebarMaxWidth = ref(0);
const isSidebarResizing = ref(false);
const previewWidth = ref(480);
const previewMaxWidth = ref(0);
const isPreviewResizing = ref(false);
const activeNav = ref<"chat" | "model" | "skill-store" | "plugins" | "connectors" | "knowledge-base" | "experts" | "scheduled-tasks" | "channels" | "trash">("chat");
const showOnboardingProject = ref(false);
const chatPanelRef = ref<{
  revealNotificationMessage: (messageId?: string) => Promise<void>;
} | null>(null);
const workspacePanelRefs = new Map<string, ComponentPublicInstance & { disposeAll: () => void }>();

let resizeStartX = 0;
let resizeStartWidth = sidebarWidth.value;
let previewResizeStartX = 0;
let previewResizeStartWidth = previewWidth.value;

function syncSidebarWidthToViewport() {
  sidebarMaxWidth.value = getSidebarMaxWidth(window.innerWidth);
  sidebarWidth.value = clampSidebarWidth(sidebarWidth.value, window.innerWidth);
}

function syncPreviewWidthToViewport() {
  previewMaxWidth.value = getPreviewMaxWidth(window.innerWidth);
  previewWidth.value = clampPreviewWidth(previewWidth.value, window.innerWidth);
}

function syncLayoutWidthsToViewport() {
  syncSidebarWidthToViewport();
  syncPreviewWidthToViewport();
}

function startSidebarResize(event: PointerEvent) {
  if (event.button !== 0) return;

  event.preventDefault();
  isSidebarResizing.value = true;
  resizeStartX = event.clientX;
  resizeStartWidth = sidebarWidth.value;
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
  window.addEventListener("pointermove", handleSidebarResize);
  window.addEventListener("pointerup", stopSidebarResize, { once: true });
  window.addEventListener("pointercancel", stopSidebarResize, { once: true });
}

function handleSidebarResize(event: PointerEvent) {
  if (!isSidebarResizing.value) return;

  sidebarWidth.value = clampSidebarWidth(
    resizeStartWidth + event.clientX - resizeStartX,
    window.innerWidth,
  );
}

function stopSidebarResize() {
  isSidebarResizing.value = false;
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
  window.removeEventListener("pointermove", handleSidebarResize);
  window.removeEventListener("pointerup", stopSidebarResize);
  window.removeEventListener("pointercancel", stopSidebarResize);
}

function startPreviewResize(event: PointerEvent) {
  if (event.button !== 0) return;

  event.preventDefault();
  isPreviewResizing.value = true;
  previewResizeStartX = event.clientX;
  previewResizeStartWidth = previewWidth.value;
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
  window.addEventListener("pointermove", handlePreviewResize);
  window.addEventListener("pointerup", stopPreviewResize, { once: true });
  window.addEventListener("pointercancel", stopPreviewResize, { once: true });
}

function handlePreviewResize(event: PointerEvent) {
  if (!isPreviewResizing.value) return;

  previewWidth.value = clampPreviewWidth(
    previewResizeStartWidth + previewResizeStartX - event.clientX,
    window.innerWidth,
  );
}

function stopPreviewResize() {
  isPreviewResizing.value = false;
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
  window.removeEventListener("pointermove", handlePreviewResize);
  window.removeEventListener("pointerup", stopPreviewResize);
  window.removeEventListener("pointercancel", stopPreviewResize);
}


const currentSession = computed(() =>
  sessionStore.sessions.find((s) => s.id === selectedSessionId.value),
);

const workspacePanelEntries = computed(() => Object.entries(workspaceTools.panels).map(([sessionId, panel]) => ({
  sessionId,
  panel,
})));

const currentWorkspacePanel = computed(() => selectedSessionId.value
  ? workspaceTools.panels[selectedSessionId.value] ?? null
  : null);

function setWorkspacePanelRef(sessionId: string, instance: ComponentPublicInstance | null) {
  if (instance) {
    workspacePanelRefs.set(sessionId, instance as ComponentPublicInstance & { disposeAll: () => void });
  } else {
    workspacePanelRefs.delete(sessionId);
  }
}

function toggleWorkspacePanel() {
  if (!selectedSessionId.value || !selectedProjectId.value) return;
  workspaceTools.togglePanel(selectedSessionId.value, selectedProjectId.value);
}

let projectLoadPromise: Promise<void> = Promise.resolve();
let sessionOpenPromise: Promise<void> = Promise.resolve();

function handleWindowFocus() {
  void notifications.markCurrentSessionReadIfViewed();
}

function handleVisibilityChange() {
  if (document.visibilityState === "visible") handleWindowFocus();
}

onMounted(async () => {
  syncLayoutWidthsToViewport();
  window.addEventListener("resize", syncLayoutWidthsToViewport);
  window.addEventListener("focus", handleWindowFocus);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  await projectStore.loadAll();
  // On page refresh, auto-open the first project's first session so the user
  // lands directly in the conversation view instead of the welcome screen.
  if (!selectedProjectId.value && projectStore.projects.length) {
    selectedProjectId.value = projectStore.projects[0]!.id;
  }
  connection.init();
  agent.init();
  await notifications.init(handleNotificationNavigation);
  trashStore.load();
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", syncLayoutWidthsToViewport);
  window.removeEventListener("focus", handleWindowFocus);
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  stopSidebarResize();
  stopPreviewResize();
});

watch(selectedProjectId, (id) => {
  projectLoadPromise = (async () => {
    selectedSessionId.value = null;
    if (!id) return;
    await projectStore.loadOne(id);
    await sessionStore.loadForProject(id);
    if (sessionStore.sessions.length) selectedSessionId.value = sessionStore.sessions[0]!.id;
  })();
}, { flush: "sync" });

watch(selectedSessionId, (id) => {
  sessionOpenPromise = (async () => {
    if (!id) return;
    await sessionStore.open(id);
    const lastMessageId = sessionStore.messages[sessionStore.messages.length - 1]?.id;
    await notifications.markCurrentSessionReadIfViewed(lastMessageId);
  })();
}, { flush: "sync" });

watch([activeNav, selectedProjectId, selectedSessionId], ([nav, projectId, sessionId]) => {
  notifications.setViewContext(nav, projectId, sessionId);
}, { immediate: true, flush: "sync" });

async function createSession() {
  if (!selectedProjectId.value) return;
  const s = await sessionStore.create(selectedProjectId.value);
  selectedSessionId.value = s.id;
}

async function createOnboardingProject(name: string, workdir: string) {
  const project = await projectStore.create(name, workdir);
  activeNav.value = "chat";
  selectedProjectId.value = project.id;
}

async function renameSession(id: string, title: string) {
  try {
    await sessionStore.update(id, title);
  } catch (e: any) {
    console.error("Failed to rename session:", e);
    message.error(`重命名失败: ${e.message}`);
  }
}

async function deleteSession(id: string) {
  try {
    await sessionStore.remove(id);
    workspacePanelRefs.get(id)?.disposeAll();
    workspaceTools.removeSession(id);
    await notifications.refreshTotalUnread();
    if (selectedSessionId.value === id) {
      selectedSessionId.value = null;
      sessionStore.current = null;
      sessionStore.messages = [];
    }
    // 刷新回收站数据，确保删除的会话会显示在回收站中
    await trashStore.load();
    message.success("已移至回收站");
  } catch (e: any) {
    console.error("Failed to delete session:", e);
    message.error(`删除失败: ${e.message}`);
  }
}

// Navigate from a non-chat view (e.g. ExpertView) to a specific session in
// the chat view. Used when the user summons an expert — we need to switch to
// chat, select the right project and session, and open it.
// After restoring a project from trash, jump back to the chat view with that
// project selected so the user sees where it went.
function navigateToProject(projectId: string) {
  activeNav.value = "chat";
  selectedProjectId.value = projectId;
}

async function navigateToSession(payload: { projectId: string; sessionId: string }) {
  activeNav.value = "chat";
  if (selectedProjectId.value !== payload.projectId) {
    selectedProjectId.value = payload.projectId;
    await projectLoadPromise;
  }
  selectedSessionId.value = payload.sessionId;
  await sessionOpenPromise;
}

async function navigateToScheduledSession(payload: {
  projectId: string;
  sessionId: string;
  messageId?: string | null;
}) {
  await navigateToSession(payload);
  await nextTick();
  await chatPanelRef.value?.revealNotificationMessage(payload.messageId ?? undefined);
}

async function handleNotificationNavigation(target: NotificationNavigationTarget) {
  await navigateToSession(target);
  await nextTick();
  await chatPanelRef.value?.revealNotificationMessage(target.messageId);
  await notifications.markSessionRead(target.sessionId, target.messageId);
}

const lightOverrides = {
  common: {
    primaryColor: "#00b894",
    primaryColorHover: "#00d4a8",
    primaryColorPressed: "#009d7e",
    primaryColorSuppl: "#00b894",
    bodyColor: "#f5f7f9",
    cardColor: "#ffffff",
    modalColor: "#ffffff",
    popoverColor: "#ffffff",
    inputColor: "#ffffff",
    actionColor: "#f8fafc",
    borderColor: "#cfd9e3",
    dividerColor: "#dbe3eb",
    textColor1: "#1a202c",
    textColor2: "#5a6577",
    textColor3: "#8b95a8",
    borderRadius: "8px",
    borderRadiusSmall: "4px",
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif',
    fontFamilyMono: '"IBM Plex Mono", ui-monospace, monospace',
  },
  Button: {
    colorPrimary: "#00b894",
    colorHoverPrimary: "#00d4a8",
    colorPressedPrimary: "#009d7e",
    textColorPrimary: "#ffffff",
    textColorHoverPrimary: "#ffffff",
    textColorPressedPrimary: "#ffffff",
    borderRadiusMedium: "8px",
  },
  Input: {
    color: "#ffffff",
    colorFocus: "#ffffff",
    border: "1px solid #cfd9e3",
    borderHover: "1px solid #aebdcb",
    borderFocus: "1px solid #00b894",
    borderRadius: "8px",
    caretColor: "#00b894",
  },
  Tree: {
    nodeColorHover: "#e4e8f0",
    nodeColorActive: "#d8dde8",
  },
};

const darkOverrides = {
  common: {
    primaryColor: "#2dd4a8",
    primaryColorHover: "#3de0b5",
    primaryColorPressed: "#18b89a",
    primaryColorSuppl: "#2dd4a8",
    bodyColor: "#111318",
    cardColor: "#1a1d24",
    modalColor: "#1a1d24",
    popoverColor: "#1a1d24",
    inputColor: "#22262e",
    actionColor: "#22262e",
    borderColor: "#2a2e37",
    dividerColor: "#22262e",
    textColor1: "#e4e7ec",
    textColor2: "#8b95a8",
    textColor3: "#5a6577",
    borderRadius: "8px",
    borderRadiusSmall: "4px",
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif',
    fontFamilyMono: '"IBM Plex Mono", ui-monospace, monospace',
  },
  Button: {
    colorPrimary: "#2dd4a8",
    colorHoverPrimary: "#3de0b5",
    colorPressedPrimary: "#18b89a",
    textColorPrimary: "#ffffff",
    textColorHoverPrimary: "#ffffff",
    textColorPressedPrimary: "#ffffff",
    borderRadiusMedium: "8px",
  },
  Input: {
    color: "#22262e",
    colorFocus: "#22262e",
    border: "1px solid #2a2e37",
    borderHover: "1px solid #3d4452",
    borderFocus: "1px solid #2dd4a8",
    borderRadius: "8px",
    caretColor: "#2dd4a8",
  },
  Tree: {
    nodeColorHover: "#22262e",
    nodeColorActive: "#2a2e37",
  },
};

const naiveTheme = computed(() => themeStore.isDark ? darkTheme : null);
const themeOverrides = computed(() => themeStore.isDark ? darkOverrides : lightOverrides);
const naiveLocale = computed(() => currentLocale.value === "zh" ? zhCN : enUS);
const naiveDateLocale = computed(() => currentLocale.value === "zh" ? dateZhCN : dateEnUS);

const hasWorkspace = computed(
  () => selectedProjectId.value && selectedSessionId.value,
);


function openProjectFile(path: string) {
  if (!selectedSessionId.value || !selectedProjectId.value) return;
  workspaceTools.showPreview(selectedSessionId.value, selectedProjectId.value, { kind: "file", path });
}

function openKbCitation(citation: KbCitationMeta) {
  if (!selectedSessionId.value || !selectedProjectId.value) return;
  workspaceTools.showPreview(selectedSessionId.value, selectedProjectId.value, { kind: "citation", citation });
}
</script>

<template>
  <NConfigProvider :theme="naiveTheme" :theme-overrides="themeOverrides" :locale="naiveLocale" :date-locale="naiveDateLocale">
    <NMessageProvider>
    <div class="app-shell">
      <NavRail :active-nav="activeNav" @navigate="activeNav = $event" />

      <div class="chat-layout" v-show="activeNav === 'chat'">
        <Sidebar
          :style="{ width: `${sidebarWidth}px` }"
          :selected-project-id="selectedProjectId"
          :selected-session-id="selectedSessionId"
          @select-project="selectedProjectId = $event"
          @select-session="selectedSessionId = $event"
          @create-session="createSession"
          @rename-session="renameSession"
          @delete-session="deleteSession"
          @select-file="openProjectFile"
        />
        <div
          class="sidebar-resizer"
          :class="{ active: isSidebarResizing }"
          role="separator"
          aria-orientation="vertical"
          :aria-valuemin="SIDEBAR_MIN_WIDTH"
          :aria-valuemax="sidebarMaxWidth"
          :aria-valuenow="sidebarWidth"
          @pointerdown="startSidebarResize"
        />

        <main class="workspace">
          <template v-if="hasWorkspace">
            <header class="workspace-header">
              <div class="header-left">
                <h1 class="project-name">{{ projectStore.current?.name }}</h1>
                <span class="session-tag" v-if="currentSession">
                  {{ currentSession.title ?? t('sidebar.newSession') }}
                </span>
              </div>
              <div class="header-right">
                <button
                  class="workspace-panel-toggle"
                  type="button"
                  :aria-label="t(currentWorkspacePanel?.visible ? 'workspaceTools.closePanel' : 'workspaceTools.openPanel')"
                  :aria-pressed="currentWorkspacePanel?.visible ?? false"
                  @click="toggleWorkspacePanel"
                >
                  {{ t(currentWorkspacePanel?.visible ? 'workspaceTools.closePanel' : 'workspaceTools.openPanel') }}
                </button>
                <span class="connection-status" :class="connection.status">
                  <span class="conn-dot" />
                  {{ connection.status === "connected" ? t('sidebar.connected') : connection.status === "connecting" ? t('sidebar.connecting') : t('sidebar.disconnected') }}
                </span>
              </div>
            </header>
          </template>

          <div class="workspace-body">
            <div v-if="hasWorkspace" class="workspace-main">
              <div class="workspace-chat">
                <ChatPanel
                  v-if="selectedSessionId"
                  ref="chatPanelRef"
                  :session-id="selectedSessionId"
                  :project-id="selectedProjectId!"
                  @select-file="openProjectFile"
                  @select-kb-citation="openKbCitation"
                  @manage-connectors="activeNav = 'connectors'"
                />
              </div>
            </div>

            <div v-else class="welcome">
              <div class="welcome-inner">
                <div class="welcome-symbol">π</div>
                <template v-if="!projectStore.projects.length">
                  <h2 class="welcome-title">{{ t('welcome.emptyTitle') }}</h2>
                  <p class="welcome-sub">{{ t('welcome.emptySub') }}</p>
                  <div class="welcome-steps">
                    <div><strong>1</strong><span>{{ t('welcome.stepProject') }}</span></div>
                    <div><strong>2</strong><span>{{ t('welcome.stepSession') }}</span></div>
                    <div><strong>3</strong><span>{{ t('welcome.stepPrompt') }}</span></div>
                  </div>
                  <button class="welcome-primary" @click="showOnboardingProject = true">{{ t('welcome.createProject') }}</button>
                </template>
                <template v-else>
                  <h2 class="welcome-title">{{ t('welcome.title') }}</h2>
                  <p class="welcome-sub">{{ t('welcome.sub') }}</p>
                  <button v-if="selectedProjectId" class="welcome-primary" @click="createSession">{{ t('welcome.createSession') }}</button>
                  <div class="welcome-hint">
                    <kbd>&#8984;</kbd> + <kbd>N</kbd> {{ t('welcome.hint') }}
                  </div>
                </template>
                <NewProjectDialog
                  :show="showOnboardingProject"
                  @close="showOnboardingProject = false"
                  @create="createOnboardingProject"
                />
              </div>
            </div>

            <WorkspaceToolPanel
              v-for="entry in workspacePanelEntries"
              :key="entry.sessionId"
              :ref="(instance) => setWorkspacePanelRef(entry.sessionId, instance as ComponentPublicInstance | null)"
              :session-id="entry.sessionId"
              :project-id="entry.panel.projectId"
              :active="Boolean(hasWorkspace && selectedSessionId === entry.sessionId)"
              :width="previewWidth"
              :min-width="PREVIEW_MIN_WIDTH"
              :max-width="previewMaxWidth"
              :is-resizing="isPreviewResizing"
              :tool-components="workspaceToolComponents"
              @resize-start="startPreviewResize"
            >
              <template #preview="{ target, projectId }">
                <WorkspacePreviewTab :target="target" :project-id="projectId" />
              </template>
            </WorkspaceToolPanel>
          </div>
        </main>
      </div>

      <ModelPanel v-if="activeNav === 'model'" />
      <SkillStoreView v-if="activeNav === 'skill-store'" />
      <PluginManagerView v-if="activeNav === 'plugins'" />
      <ConnectorView v-if="activeNav === 'connectors'" :project-id="selectedProjectId" />
      <KnowledgeBaseView v-if="activeNav === 'knowledge-base'" />
      <ExpertView v-if="activeNav === 'experts'" @summon-session="navigateToSession" />
      <ScheduledTasksView v-if="activeNav === 'scheduled-tasks'" @navigate-session="navigateToScheduledSession" @manage-connectors="activeNav = 'connectors'" />
      <ChannelView v-if="activeNav === 'channels'" />
      <TrashView v-if="activeNav === 'trash'" @restore-project="navigateToProject" />
    </div>
    </NMessageProvider>
  </NConfigProvider>
</template>

<style scoped>
.app-shell {
  display: flex;
  height: 100vh;
  overflow: hidden;
  background: var(--bg-void);
}

.chat-layout {
  flex: 1;
  display: flex;
  min-width: 0;
  overflow: hidden;
}

.workspace {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--bg-surface);
  border-left: 1px solid var(--border-default);
}

/* ─── Header ─── */

.workspace-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: var(--header-height);
  padding: 0 20px;
  border-bottom: 1px solid var(--border-default);
  background: var(--bg-surface);
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.project-name {
  font-family: var(--font-mono);
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: -0.01em;
}
.session-tag {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  background: var(--accent-dim);
  color: var(--accent);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.workspace-panel-toggle {
  padding: 6px 9px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
}

.workspace-panel-toggle:hover,
.workspace-panel-toggle[aria-pressed="true"] {
  border-color: var(--accent);
  color: var(--accent);
}



.connection-status {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-mono);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
}
.connection-status.connected {
  color: var(--green);
}
.connection-status.connecting {
  color: var(--amber);
}
.connection-status.disconnected {
  color: var(--rose);
}

.conn-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}
.connection-status.connecting .conn-dot {
  animation: pulse 1.5s ease infinite;
}

/* ─── Workspace Body ─── */

.workspace-body {
  flex: 1;
  display: flex;
  min-height: 0;
  overflow: hidden;
}

.sidebar-resizer {
  position: relative;
  z-index: 2;
  flex: 0 0 6px;
  width: 6px;
  margin: 0 -3px;
  cursor: col-resize;
  touch-action: none;
}

.sidebar-resizer::after {
  position: absolute;
  inset: 0 2px;
  content: "";
  background: transparent;
  transition: background var(--transition-fast);
}

.sidebar-resizer:hover::after,
.sidebar-resizer.active::after {
  background: var(--accent);
}

.workspace-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

/* ─── Chat Area ─── */

.workspace-chat {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ─── Welcome ─── */

.welcome {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-surface);
  position: relative;
  overflow: hidden;
}

.welcome::before {
  content: "";
  position: absolute;
  inset: 0;
  background-image:
    radial-gradient(circle at 1px 1px, var(--border-subtle) 1px, transparent 0);
  background-size: 32px 32px;
  opacity: 0.5;
}

.welcome-inner {
  position: relative;
  text-align: center;
  animation: fadeIn 0.6s var(--ease-out) both;
}

.welcome-symbol {
  font-family: var(--font-mono);
  font-size: 80px;
  font-weight: 700;
  color: var(--accent);
  line-height: 1;
  opacity: 0.15;
  margin-bottom: 8px;
  text-shadow: 0 0 60px var(--accent-glow);
}

.welcome-title {
  font-family: var(--font-mono);
  font-size: 24px;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: -0.02em;
  margin-bottom: 8px;
}

.welcome-sub {
  font-size: 14px;
  color: var(--text-muted);
  max-width: 320px;
  line-height: 1.6;
}

.welcome-hint {
  margin-top: 24px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-faint);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.welcome-hint kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  padding: 0 5px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-default);
  border-radius: 4px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-secondary);
}

.welcome-primary {
  margin-top: 22px;
  padding: 9px 16px;
  border: 1px solid var(--accent);
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: var(--bg-void);
  font-weight: 600;
  cursor: pointer;
}

.welcome-steps {
  display: grid;
  gap: 8px;
  margin-top: 22px;
  text-align: left;
}

.welcome-steps div {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--text-muted);
  font-size: 12px;
}

.welcome-steps strong {
  display: grid;
  width: 22px;
  height: 22px;
  place-items: center;
  border: 1px solid var(--border-default);
  border-radius: 50%;
  color: var(--accent);
  font-size: 11px;
}
</style>
