<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { NButton, NDrawer, NSelect, NSpin, NSwitch, useMessage } from "naive-ui";
import type { ChannelConfigDto, ProjectDto } from "@pi-web-ui/shared";
import { api } from "../api/client.js";
import { useChannelStore } from "../stores/channel.js";
import { useI18n } from "../i18n/index.js";

const props = defineProps<{ show: boolean; config: ChannelConfigDto | null }>();
const emit = defineEmits<{ (e: "update:show", value: boolean): void; (e: "saved"): void }>();

type WeChatStatus = {
  state: "idle" | "requesting" | "awaiting_scan" | "scanned" | "logged_in" | "expired" | "error";
  qrDataUrl?: string;
  userId?: string;
  error?: string;
};
type Conversation = { userId: string; sessionId: string; title: string | null; updatedAt: number };

const { t } = useI18n();
const store = useChannelStore();
const message = useMessage();
const projects = ref<ProjectDto[]>([]);
const projectId = ref<string | null>(null);
const enabled = ref(true);
const status = ref<WeChatStatus>({ state: "idle" });
const conversations = ref<Conversation[]>([]);
const saving = ref(false);
let pollTimer: ReturnType<typeof setInterval> | null = null;

const projectOptions = computed(() =>
  projects.value.map((p) => ({ label: p.name, value: p.id })),
);

/** Resolved project name for display; falls back to ID if not found. */
const selectedProjectName = computed(() => {
  if (!projectId.value) return null;
  const p = projects.value.find((p) => p.id === projectId.value);
  return p ? p.name : projectId.value;
});
const isLoggedIn = computed(() => status.value.state === "logged_in");
const statusLabel = computed(() => {
  if (status.value.state === "requesting") return t("channel.wechat.requesting");
  if (status.value.state === "scanned") return t("channel.wechat.scanToConfirm");
  if (status.value.state === "logged_in") return t("channel.wechat.loggedIn");
  if (status.value.state === "error") return status.value.error || t("channel.wechat.loginFailed");
  return t("channel.wechat.scanning");
});

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

async function refresh() {
  try { status.value = await api.wechatStatus(); } catch {}
}

async function loadDrawer() {
  // Set projectId first (same pattern as DingTalkChannelDrawer).
  projectId.value = extractProjectId(props.config);
  enabled.value = props.config?.enabled ?? true;
  try {
    const [projectList, conversationList] = await Promise.all([api.listProjects(), api.wechatConversations()]);
    projects.value = projectList;
    conversations.value = conversationList;
    await refresh();
  } catch {
    // ignore transient errors during load
  }
}

async function startLogin() {
  try {
    await api.wechatStartLogin();
    await refresh();
  } catch (error: any) {
    message.error(error?.message ?? t("channel.wechat.loginFailed"));
  }
}

async function logout() {
  try {
    await api.wechatLogout();
    await refresh();
  } catch (error: any) {
    message.error(error?.message ?? t("channel.wechat.loginFailed"));
  }
}

async function save() {
  if (!projectId.value) {
    message.warning(t("channel.wechat.projectRequired"));
    return;
  }
  saving.value = true;
  try {
    const config = { ...(props.config?.config ?? {}), projectId: projectId.value };
    if (props.config) await store.update(props.config.id, { enabled: enabled.value, config });
    else await store.create({ type: "wechat", name: t("channel.wechat.name"), config });
    message.success(t("channel.save"));
    emit("saved");
  } catch (error: any) {
    message.error(error?.message ?? t("channel.save"));
  } finally {
    saving.value = false;
  }
}

/** Extract projectId from config, handling various data shapes. */
function extractProjectId(config: typeof props.config): string | null {
  if (!config) return null;
  const raw = config.config?.projectId;
  if (typeof raw === "string" && raw.length > 0) return raw;
  return null;
}

// Sync projectId whenever the config prop changes (covers late store loads).
watch(() => props.config, (cfg) => {
  const id = extractProjectId(cfg);
  if (id) projectId.value = id;
}, { deep: true });

watch(() => props.show, (visible) => {
  stopPolling();
  if (!visible) return;
  void loadDrawer();
  pollTimer = setInterval(() => { void refresh(); }, 1_000);
});

onUnmounted(stopPolling);
</script>

<template>
  <NDrawer placement="right" :show="show" :width="460" @update:show="(value: boolean) => emit('update:show', value)">
    <section class="wechat-drawer">
      <header class="drawer-header">
        <div>
          <h2>{{ t('channel.wechat.drawerTitle') }}</h2>
          <p>{{ t('channel.wechat.drawerDesc') }}</p>
        </div>
        <button class="drawer-close" type="button" @click="emit('update:show', false)">×</button>
      </header>

      <div class="drawer-body">
        <section class="drawer-section">
          <div class="section-heading">
            <h3>{{ t('channel.wechat.project') }}</h3>
            <NSwitch :value="enabled" @update:value="(value: boolean) => enabled = value" />
          </div>
          <NSelect
            :key="selectedProjectName ?? '__none__'"
            v-model:value="projectId"
            :options="projectOptions"
            :placeholder="t('channel.wechat.projectPlaceholder')"
          />
          <p class="hint">{{ t('channel.wechat.projectHint') }}</p>
        </section>

        <section class="drawer-section qr-section">
          <div class="section-heading"><h3>{{ t('channel.wechat.scanLogin') }}</h3></div>
          <div class="qr-area">
            <img v-if="status.qrDataUrl" :src="status.qrDataUrl" class="qr-image" alt="WeChat QR" />
            <div v-else-if="status.state === 'requesting' || status.state === 'idle'" class="qr-requesting">
              <NSpin size="medium" />
              <span class="qr-requesting-text">{{ t('channel.wechat.requesting') }}</span>
            </div>
            <NSpin v-else-if="status.state !== 'error' && !isLoggedIn" size="medium" />
            <span v-else-if="isLoggedIn" class="logged-in">{{ status.userId }}</span>
            <span v-else class="login-error">{{ status.error || t('channel.wechat.loginFailed') }}</span>
          </div>
          <p class="status-text" :class="{ error: status.state === 'error' }">{{ statusLabel }}</p>
          <div class="drawer-actions">
            <NButton v-if="!isLoggedIn" size="small" type="primary" @click="startLogin">{{ t('channel.wechat.scanLogin') }}</NButton>
            <NButton v-else size="small" type="error" secondary @click="logout">{{ t('channel.wechat.logout') }}</NButton>
          </div>
        </section>

        <section class="drawer-section">
          <div class="section-heading"><h3>{{ t('channel.wechat.conversations') }}</h3></div>
          <p class="hint">{{ t('channel.wechat.conversationsHint') }}</p>
          <div v-if="!conversations.length" class="empty-conversations">{{ t('channel.wechat.noConversations') }}</div>
          <div v-for="conversation in conversations" :key="conversation.userId" class="conversation-row">
            <span class="conversation-user">{{ conversation.userId }}</span>
            <span class="conversation-title">{{ conversation.title || conversation.sessionId }}</span>
          </div>
        </section>
      </div>

      <footer class="drawer-footer">
        <NButton @click="emit('update:show', false)">{{ t('channel.cancel') }}</NButton>
        <NButton type="primary" :loading="saving" @click="save">{{ t('channel.save') }}</NButton>
      </footer>
    </section>
  </NDrawer>
</template>

<style scoped>
.wechat-drawer { height: 100%; display: flex; flex-direction: column; background: var(--bg-deep); }
.drawer-header { display: flex; justify-content: space-between; gap: 16px; padding: 28px 28px 20px; border-bottom: 1px solid var(--border-default); }
.drawer-header h2, .drawer-header p, .section-heading h3 { margin: 0; }
.drawer-header h2 { color: var(--text-primary); font-size: 20px; }
.drawer-header p { margin-top: 6px; color: var(--text-muted); font-size: 12px; line-height: 1.5; }
.drawer-close { border: 0; background: transparent; color: var(--text-muted); font-size: 28px; line-height: 1; cursor: pointer; }
.drawer-body { flex: 1; overflow: auto; padding: 22px 28px; display: flex; flex-direction: column; gap: 18px; }
.drawer-section { padding: 16px; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--bg-surface); }
.section-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
.section-heading h3 { color: var(--text-primary); font-size: 13px; }
.hint, .status-text { margin: 8px 0 0; color: var(--text-muted); font-size: 12px; line-height: 1.5; }
.qr-section { text-align: center; }
.qr-section .section-heading { text-align: left; }
.qr-area { width: 196px; height: 196px; margin: 12px auto 0; display: grid; place-items: center; border-radius: var(--radius-sm); background: #fff; }
.qr-image { width: 184px; height: 184px; object-fit: contain; }
.logged-in { color: #0f9d74; font-family: var(--font-mono); font-size: 12px; word-break: break-all; padding: 12px; }
.qr-requesting { display: flex; flex-direction: column; align-items: center; gap: 10px; }
.qr-requesting-text { font-size: 12px; color: var(--text-muted); font-family: var(--font-mono); }
.login-error, .status-text.error { color: var(--rose); }
.drawer-actions { margin-top: 12px; }
.conversation-row { display: flex; flex-direction: column; gap: 3px; padding: 10px 0; border-top: 1px solid var(--border-subtle); }
.conversation-user { color: var(--text-primary); font-family: var(--font-mono); font-size: 12px; }
.conversation-title { color: var(--text-muted); font-size: 11px; }
.empty-conversations { color: var(--text-faint); font-size: 12px; padding: 8px 0 0; }
.drawer-footer { display: flex; justify-content: flex-end; gap: 10px; padding: 16px 28px; border-top: 1px solid var(--border-default); }
</style>
