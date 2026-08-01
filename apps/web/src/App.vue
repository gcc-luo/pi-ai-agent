<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick, defineAsyncComponent } from "vue";
import { NConfigProvider, NSelect, NMessageProvider, darkTheme, zhCN, enUS, dateZhCN, dateEnUS } from "naive-ui";
import Sidebar from "./components/Sidebar.vue";
import ChatPanel from "./components/ChatPanel.vue";
const TuiTerminalPanel = defineAsyncComponent(() => import("./components/TuiTerminalPanel.vue"));
// Lazy-loaded so the whole preview pipeline (highlight.js, mammoth, xlsx and
// the 10 preview SFCs) lives in its own chunk and never lands in the main
// bundle for users who only browse the chat.
const FileViewer = defineAsyncComponent(() => import("./components/FileViewer.vue"));
import NavRail from "./components/NavRail.vue";
import ModelPanel from "./components/ModelPanel.vue";
const SkillStoreView = defineAsyncComponent(() => import("./components/SkillStoreView.vue"));
const KnowledgeBaseView = defineAsyncComponent(() => import("./components/KnowledgeBaseView.vue"));
const TrashView = defineAsyncComponent(() => import("./components/TrashView.vue"));
const ExpertView = defineAsyncComponent(() => import("./components/ExpertView.vue"));
const ScheduledTasksView = defineAsyncComponent(() => import("./components/ScheduledTasksView.vue"));
const ChannelView = defineAsyncComponent(() => import("./components/ChannelView.vue"));
const PluginManagerView = defineAsyncComponent(() => import("./components/PluginManagerView.vue"));
import { useProjectStore } from "./stores/project.js";
import { useSessionStore } from "./stores/session.js";
import { useConnectionStore } from "./stores/connection.js";
import { useAgentStore } from "./stores/agent.js";
import { useTrashStore } from "./stores/trash.js";
import { useThemeStore } from "./stores/theme.js";
import { useModeStore } from "./stores/mode.js";
import { useI18n } from "./i18n/index.js";

const projectStore = useProjectStore();
const sessionStore = useSessionStore();
const connection = useConnectionStore();
const agent = useAgentStore();
const trashStore = useTrashStore();
const themeStore = useThemeStore();
const modeStore = useModeStore();
const { t, currentLocale } = useI18n();

const selectedProjectId = ref<string | null>(null);
const selectedSessionId = ref<string | null>(null);
const filePath = ref<string | null>(null);
const activeNav = ref<"chat" | "model" | "skill-store" | "plugins" | "knowledge-base" | "experts" | "scheduled-tasks" | "channels" | "trash">("chat");

const currentSession = computed(() =>
  sessionStore.sessions.find((s) => s.id === selectedSessionId.value),
);

onMounted(async () => {
  await projectStore.loadAll();
  // On page refresh, auto-open the first project's first session so the user
  // lands directly in the conversation view instead of the welcome screen.
  if (!selectedProjectId.value && projectStore.projects.length) {
    selectedProjectId.value = projectStore.projects[0]!.id;
  }
  connection.init();
  agent.init();
  trashStore.load();
});

watch(selectedProjectId, async (id) => {
  filePath.value = null;
  selectedSessionId.value = null;
  if (id) {
    await projectStore.loadOne(id);
    await sessionStore.loadForProject(id);
    if (sessionStore.sessions.length) {
      selectedSessionId.value = sessionStore.sessions[0]!.id;
    }
  }
});

watch(selectedSessionId, async (id) => {
  if (id) await sessionStore.open(id);
});

async function createProject(name: string, workdir: string) {
  try {
    const p = await projectStore.create(name, workdir);
    selectedProjectId.value = p.id;
  } catch (e: any) {
    console.error("Failed to create project:", e);
    alert(`${e.message}`);
  }
}

async function createSession() {
  if (!selectedProjectId.value) return;
  const s = await sessionStore.create(selectedProjectId.value);
  selectedSessionId.value = s.id;
}

async function renameProject(id: string, name: string) {
  try {
    await projectStore.update(id, name);
  } catch (e: any) {
    console.error("Failed to rename project:", e);
    alert(`${e.message}`);
  }
}

async function deleteProject(id: string) {
  try {
    await projectStore.remove(id);
    if (selectedProjectId.value === id) {
      sessionStore.$reset();
      selectedProjectId.value = null;
    }
    // 刷新回收站数据，确保删除的项目会显示在回收站中
    await trashStore.load();
  } catch (e: any) {
    console.error("Failed to delete project:", e);
    alert(`${e.message}`);
  }
}

async function renameSession(id: string, title: string) {
  try {
    await sessionStore.update(id, title);
  } catch (e: any) {
    console.error("Failed to rename session:", e);
    alert(`${e.message}`);
  }
}

async function deleteSession(id: string) {
  try {
    await sessionStore.remove(id);
    if (selectedSessionId.value === id) {
      selectedSessionId.value = null;
      sessionStore.current = null;
      sessionStore.messages = [];
    }
    // 刷新回收站数据，确保删除的会话会显示在回收站中
    await trashStore.load();
  } catch (e: any) {
    console.error("Failed to delete session:", e);
    alert(`${e.message}`);
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
    // Setting selectedProjectId triggers a watcher that loads sessions and
    // auto-selects the first one. We wait for it to finish, then override
    // with the expert session we actually want.
    selectedProjectId.value = payload.projectId;
    await nextTick();
    // Give the watcher time to complete its async loads.
    await new Promise((r) => setTimeout(r, 100));
  }
  selectedSessionId.value = payload.sessionId;
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

const modelSelectOptions = computed(() =>
  agent.models.map((m) => ({ label: m.label, value: m.id })),
);

const showPreview = computed(() => filePath.value !== null);

function closePreview() {
  filePath.value = null;
}
</script>

<template>
  <NConfigProvider :theme="naiveTheme" :theme-overrides="themeOverrides" :locale="naiveLocale" :date-locale="naiveDateLocale">
    <NMessageProvider>
    <div class="app-shell">
      <NavRail :active-nav="activeNav" @navigate="activeNav = $event" />

      <template v-if="activeNav === 'chat'">
        <Sidebar
          :selected-project-id="selectedProjectId"
          :selected-session-id="selectedSessionId"
          @select-project="selectedProjectId = $event"
          @select-session="selectedSessionId = $event"
          @create-project="createProject"
          @rename-project="renameProject"
          @delete-project="deleteProject"
          @create-session="createSession"
          @rename-session="renameSession"
          @delete-session="deleteSession"
          @select-file="filePath = $event"
        />

        <main class="workspace">
          <template v-if="hasWorkspace">
            <!-- Header -->
            <header class="workspace-header">
              <div class="header-left">
                <h1 class="project-name">{{ projectStore.current?.name }}</h1>
                <span class="session-tag" v-if="currentSession">
                  {{ currentSession.title ?? t('sidebar.newSession') }}
                </span>
              </div>
              <div class="header-right">
                <NSelect
                  v-if="agent.models.length"
                  :value="agent.currentModel"
                  :options="modelSelectOptions"
                  size="small"
                  :placeholder="t('model.selectForChat')"
                  class="model-select"
                  @update:value="agent.switchModel($event, selectedSessionId ?? undefined)"
                />
                <!-- Mode switch temporarily hidden
                <div class="workspace-mode-switch" role="group" :aria-label="t('settings.workMode')">
                  <button
                    type="button"
                    class="workspace-mode-btn"
                    :class="{ active: !modeStore.isCoding }"
                    @click="modeStore.set('office')"
                  >{{ t('settings.modeOffice') }}</button>
                  <button
                    type="button"
                    class="workspace-mode-btn"
                    :class="{ active: modeStore.isCoding }"
                    @click="modeStore.set('coding')"
                  >{{ t('settings.modeCoding') }}</button>
                </div>
                -->
                <span class="connection-status" :class="connection.status">
                  <span class="conn-dot" />
                  {{ connection.status === "connected" ? t('sidebar.connected') : connection.status === "connecting" ? t('sidebar.connecting') : t('sidebar.disconnected') }}
                </span>
              </div>
            </header>

            <!-- Main content area: chat + preview panel -->
            <div class="workspace-body">
              <!-- Chat Area -->
              <div class="workspace-main">
                <div class="workspace-chat">
                  <TuiTerminalPanel
                    v-if="modeStore.isCoding && selectedSessionId"
                    :session-id="selectedSessionId"
                  />
                  <ChatPanel
                    v-else-if="selectedSessionId"
                    :session-id="selectedSessionId"
                    :project-id="selectedProjectId!"
                    @select-file="filePath = $event"
                  />
                </div>
              </div>

              <!-- Right preview panel (slides in, office mode only) -->
              <Transition name="preview-slide" v-if="!modeStore.isCoding">
                <div v-if="showPreview" class="workspace-preview">
                  <div class="preview-header">
                    <span class="preview-title">{{ filePath?.split('/').pop() }}</span>
                    <button class="preview-close" @click="closePreview">
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
                      </svg>
                    </button>
                  </div>
                  <div class="preview-body">
                    <FileViewer :project-id="selectedProjectId!" :path="filePath" hide-header />
                  </div>
                </div>
              </Transition>
            </div>
          </template>

          <!-- Welcome Screen -->
          <div v-else class="welcome">
            <div class="welcome-inner">
              <div class="welcome-symbol">π</div>
              <h2 class="welcome-title">{{ t('welcome.title') }}</h2>
              <p class="welcome-sub">{{ t('welcome.sub') }}</p>
              <div class="welcome-hint">
                <kbd>&#8984;</kbd> + <kbd>N</kbd> {{ t('welcome.hint') }}
              </div>
            </div>
          </div>
        </main>
      </template>

      <ModelPanel v-else-if="activeNav === 'model'" />
      <SkillStoreView v-else-if="activeNav === 'skill-store'" />
      <PluginManagerView v-else-if="activeNav === 'plugins'" />
      <KnowledgeBaseView v-else-if="activeNav === 'knowledge-base'" />
      <ExpertView v-else-if="activeNav === 'experts'" @summon-session="navigateToSession" />
      <ScheduledTasksView v-else-if="activeNav === 'scheduled-tasks'" @navigate-session="navigateToSession" />
      <ChannelView v-else-if="activeNav === 'channels'" />
      <TrashView v-else-if="activeNav === 'trash'" @restore-project="navigateToProject" />
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

.model-select {
  width: 180px;
}
.model-select :deep(.n-base-selection) {
  background: var(--bg-surface);
}
.model-select :deep(.n-base-selection .n-base-selection-label) {
  background: var(--bg-surface);
}
.model-select :deep(.n-base-selection-input) {
  background: transparent;
}

.workspace-mode-switch {
  display: inline-flex;
  flex-shrink: 0;
  overflow: hidden;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
}

.workspace-mode-btn {
  min-width: 52px;
  padding: 5px 9px;
  border: 0;
  border-right: 1px solid var(--border-default);
  background: transparent;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color var(--transition-fast), color var(--transition-fast);
}
.workspace-mode-btn:last-child { border-right: 0; }
.workspace-mode-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
.workspace-mode-btn.active { background: var(--accent); color: #fff; }

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

/* ─── Preview Panel ─── */

.workspace-preview {
  width: 480px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--border-default);
  background: var(--bg-deep);
  box-shadow: -4px 0 24px rgba(0, 0, 0, 0.25);
}

.preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  height: 38px;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.preview-title {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
}
.preview-close:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.preview-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* ─── Preview Slide Transition ─── */

.preview-slide-enter-active {
  animation: previewIn 0.3s var(--ease-spring) both;
}
.preview-slide-leave-active {
  animation: previewOut 0.2s var(--ease-out) both;
}

@keyframes previewIn {
  from {
    opacity: 0;
    transform: translateX(20px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

@keyframes previewOut {
  from {
    opacity: 1;
    transform: translateX(0);
  }
  to {
    opacity: 0;
    transform: translateX(20px);
  }
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
</style>
