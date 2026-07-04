<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { NConfigProvider, darkTheme, NSelect } from "naive-ui";
import Sidebar from "./components/Sidebar.vue";
import ChatPanel from "./components/ChatPanel.vue";
import FileTree from "./components/FileTree.vue";
import FileViewer from "./components/FileViewer.vue";
import NavRail from "./components/NavRail.vue";
import ModelPanel from "./components/ModelPanel.vue";
import { useProjectStore } from "./stores/project.js";
import { useSessionStore } from "./stores/session.js";
import { useConnectionStore } from "./stores/connection.js";
import { useAgentStore } from "./stores/agent.js";
import { useThemeStore } from "./stores/theme.js";
import { useI18n } from "./i18n/index.js";

const projectStore = useProjectStore();
const sessionStore = useSessionStore();
const connection = useConnectionStore();
const agent = useAgentStore();
const themeStore = useThemeStore();
const { t } = useI18n();

const selectedProjectId = ref<string | null>(null);
const selectedSessionId = ref<string | null>(null);
const filePath = ref<string | null>(null);
const activeNav = ref<"chat" | "model">("chat");

const currentSession = computed(() =>
  sessionStore.sessions.find((s) => s.id === selectedSessionId.value),
);

onMounted(() => {
  projectStore.loadAll();
  connection.init();
  agent.init();
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

async function createProject(name: string) {
  const p = await projectStore.create(name);
  selectedProjectId.value = p.id;
}

async function createSession() {
  if (!selectedProjectId.value) return;
  const s = await sessionStore.create(selectedProjectId.value);
  selectedSessionId.value = s.id;
}

const darkOverrides = {
  common: {
    primaryColor: "#00ddb3",
    primaryColorHover: "#20f0c8",
    primaryColorPressed: "#00c49e",
    primaryColorSuppl: "#00ddb3",
    bodyColor: "#0b1017",
    cardColor: "#0f1623",
    modalColor: "#151d2e",
    popoverColor: "#151d2e",
    inputColor: "#151d2e",
    actionColor: "#1c2640",
    borderColor: "#1c2438",
    dividerColor: "#1c2438",
    textColor1: "#e4e8ef",
    textColor2: "#8b95a8",
    textColor3: "#5a6478",
    borderRadius: "8px",
    borderRadiusSmall: "4px",
    fontFamily: '"Sora", system-ui, -apple-system, sans-serif',
    fontFamilyMono: '"IBM Plex Mono", ui-monospace, monospace',
  },
  Button: {
    colorPrimary: "#00ddb3",
    colorHoverPrimary: "#20f0c8",
    colorPressedPrimary: "#00c49e",
    textColorPrimary: "#06090f",
    textColorHoverPrimary: "#06090f",
    textColorPressedPrimary: "#06090f",
    borderRadiusMedium: "8px",
  },
  Input: {
    color: "#151d2e",
    colorFocus: "#151d2e",
    border: "1px solid #1c2438",
    borderHover: "1px solid #2a3650",
    borderFocus: "1px solid #00ddb3",
    borderRadius: "8px",
    caretColor: "#00ddb3",
  },
  Tree: {
    nodeColorHover: "#1c2640",
    nodeColorActive: "#223050",
  },
};

const lightOverrides = {
  common: {
    primaryColor: "#00b894",
    primaryColorHover: "#00d4a8",
    primaryColorPressed: "#009d7e",
    primaryColorSuppl: "#00b894",
    bodyColor: "#eef1f6",
    cardColor: "#ffffff",
    modalColor: "#f0f3f8",
    popoverColor: "#f0f3f8",
    inputColor: "#f0f3f8",
    actionColor: "#e4e8f0",
    borderColor: "#dde2ea",
    dividerColor: "#dde2ea",
    textColor1: "#1a202c",
    textColor2: "#5a6577",
    textColor3: "#8b95a8",
    borderRadius: "8px",
    borderRadiusSmall: "4px",
    fontFamily: '"Sora", system-ui, -apple-system, sans-serif',
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
    color: "#f0f3f8",
    colorFocus: "#f0f3f8",
    border: "1px solid #dde2ea",
    borderHover: "1px solid #c5cdd8",
    borderFocus: "1px solid #00b894",
    borderRadius: "8px",
    caretColor: "#00b894",
  },
  Tree: {
    nodeColorHover: "#e4e8f0",
    nodeColorActive: "#d8dde8",
  },
};

const naiveTheme = computed(() => themeStore.isDark ? darkTheme : null);
const themeOverrides = computed(() => themeStore.isDark ? darkOverrides : lightOverrides);

const hasWorkspace = computed(
  () => selectedProjectId.value && selectedSessionId.value,
);

const modelSelectOptions = computed(() =>
  agent.models.map((m) => ({ label: m.label, value: m.id })),
);
</script>

<template>
  <NConfigProvider :theme="naiveTheme" :theme-overrides="themeOverrides">
    <div class="app-shell">
      <NavRail :active-nav="activeNav" @navigate="activeNav = $event" />

      <template v-if="activeNav === 'chat'">
        <Sidebar
          :selected-project-id="selectedProjectId"
          :selected-session-id="selectedSessionId"
          @select-project="selectedProjectId = $event"
          @select-session="selectedSessionId = $event"
          @create-project="createProject"
          @create-session="createSession"
        />

        <main class="workspace">
          <template v-if="hasWorkspace">
            <!-- Header -->
            <header class="workspace-header">
              <div class="header-left">
                <h1 class="project-name">{{ projectStore.current?.name }}</h1>
                <span class="session-tag" v-if="currentSession">
                  {{ currentSession.title ?? currentSession.id.slice(0, 8) }}
                </span>
                <span
                  class="status-dot"
                  :class="currentSession?.status ?? 'idle'"
                  :title="currentSession?.status"
                />
              </div>
              <div class="header-right">
                <NSelect
                  v-if="agent.models.length"
                  :value="agent.currentModel"
                  :options="modelSelectOptions"
                  size="small"
                  :placeholder="t('model.selectForChat')"
                  class="model-select"
                  @update:value="agent.switchModel($event)"
                />
                <span class="connection-status" :class="connection.status">
                  <span class="conn-dot" />
                  {{ connection.status === "connected" ? t('sidebar.connected') : connection.status === "connecting" ? t('sidebar.connecting') : t('sidebar.disconnected') }}
                </span>
              </div>
            </header>

            <!-- Chat Area -->
            <div class="workspace-chat">
              <ChatPanel v-if="selectedSessionId" :session-id="selectedSessionId" />
            </div>

            <!-- Files Area -->
            <div class="workspace-files">
              <div class="files-tree-panel">
                <div class="panel-label">{{ t('header.files') }}</div>
                <FileTree :project-id="selectedProjectId!" @select="filePath = $event" />
              </div>
              <div class="files-viewer-panel">
                <FileViewer :project-id="selectedProjectId!" :path="filePath" />
              </div>
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

      <ModelPanel v-else />
    </div>
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

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-muted);
}
.status-dot.active {
  background: var(--green);
  box-shadow: 0 0 8px var(--green-dim);
}
.status-dot.idle {
  background: var(--amber);
}
.status-dot.suspended {
  background: var(--text-muted);
}
.status-dot.crashed {
  background: var(--rose);
  box-shadow: 0 0 8px var(--rose-dim);
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.model-select {
  width: 180px;
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

/* ─── Workspace Areas ─── */

.workspace-chat {
  flex: 1 1 55%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.workspace-files {
  flex: 0 0 38%;
  display: flex;
  border-top: 1px solid var(--border-default);
  min-height: 160px;
  max-height: 45%;
}

.files-tree-panel {
  flex: 0 0 240px;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border-default);
  background: var(--bg-deep);
}

.panel-label {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--text-faint);
  padding: 10px 14px 6px;
  flex-shrink: 0;
}

.files-viewer-panel {
  flex: 1;
  min-width: 0;
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
</style>
