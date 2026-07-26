<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";
import { NModal, NButton, NSpin, useMessage } from "naive-ui";
import { api } from "../api/client.js";
import { useI18n } from "../i18n/index.js";

const props = defineProps<{ show: boolean }>();
const emit = defineEmits<{
  (e: "update:show", v: boolean): void;
  (e: "logged-in"): void;
}>();

const { t } = useI18n();
const message = useMessage();

type Status = {
  state: "idle" | "awaiting_scan" | "scanned" | "logged_in" | "expired" | "error";
  qrDataUrl?: string;
  userId?: string;
  error?: string;
};

const status = ref<Status>({ state: "idle" });
let pollTimer: ReturnType<typeof setInterval> | null = null;

async function refresh() {
  try {
    status.value = await api.wechatStatus();
    if (status.value.state === "logged_in") {
      message.success(t("channel.wechat.loginSuccess"));
      emit("logged-in");
      emit("update:show", false);
    }
  } catch {
    // ignore transient polling errors
  }
}

async function startLogin() {
  try {
    await api.wechatStartLogin();
  } catch (e: any) {
    message.error(e?.message ?? t("channel.wechat.loginFailed"));
    emit("update:show", false);
  }
}

watch(
  () => props.show,
  (visible) => {
    if (visible) {
      status.value = { state: "idle" };
      void startLogin();
      pollTimer = setInterval(refresh, 1000);
    } else if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  },
);

onMounted(() => {
  if (!props.show) return;
  void startLogin();
  pollTimer = setInterval(refresh, 1000);
});

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
});

const statusText = (s: Status["state"]): string => {
  switch (s) {
    case "idle": return t("channel.wechat.scanning");
    case "awaiting_scan": return t("channel.wechat.scanning");
    case "scanned": return t("channel.wechat.scanToConfirm");
    case "logged_in": return t("channel.wechat.loggedIn");
    case "expired": return t("channel.wechat.scanning");
    case "error": return t("channel.wechat.loginFailed");
  }
};
</script>

<template>
  <NModal :show="show" @update:show="(v: boolean) => emit('update:show', v)">
    <div class="dialog" @click.stop>
      <div class="dialog-header">
        <h3 class="dialog-title">{{ t('channel.wechat.scanLogin') }}</h3>
        <button class="dialog-close" @click="emit('update:show', false)">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
          </svg>
        </button>
      </div>

      <div class="dialog-body">
        <div class="qr-area">
          <NSpin v-if="!status.qrDataUrl && status.state !== 'error'" size="medium" />
          <img v-else-if="status.qrDataUrl" class="qr-img" :src="status.qrDataUrl" alt="WeChat QR" />
          <div v-else class="qr-error">{{ status.error || t('channel.wechat.loginFailed') }}</div>
        </div>
        <p class="status-text">{{ statusText(status.state) }}</p>
      </div>

      <div class="dialog-actions">
        <button class="btn-cancel" @click="emit('update:show', false)">{{ t('channel.cancel') }}</button>
      </div>
    </div>
  </NModal>
</template>

<style scoped>
.dialog {
  width: 360px;
  max-width: 90vw;
  display: flex;
  flex-direction: column;
  background: var(--bg-deep);
  border: 1px solid var(--border-default);
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 12px;
}

.dialog-title {
  font-family: var(--font-mono);
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.dialog-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
}
.dialog-close:hover { background: var(--bg-hover); color: var(--text-primary); }

.dialog-body {
  padding: 8px 20px 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
}

.qr-area {
  width: 220px;
  height: 220px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #fff;
  border-radius: var(--radius-sm);
  padding: 8px;
}

.qr-img {
  width: 200px;
  height: 200px;
  object-fit: contain;
}

.qr-error {
  font-size: 12px;
  color: var(--rose);
  text-align: center;
}

.status-text {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-muted);
  margin: 0;
  text-align: center;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 8px 20px 16px;
}

.btn-cancel {
  padding: 7px 18px;
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid var(--border-default);
  background: transparent;
  color: var(--text-muted);
  transition: all var(--transition-fast);
}
.btn-cancel:hover {
  border-color: var(--text-muted);
  color: var(--text-primary);
}
</style>
