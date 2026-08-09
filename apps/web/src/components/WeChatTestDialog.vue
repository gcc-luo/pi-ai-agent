<script setup lang="ts">
import { ref, watch } from "vue";
import { NModal, NInput, NButton, useMessage } from "naive-ui";
import { api } from "../api/client.js";
import { useI18n } from "../i18n/index.js";

const props = defineProps<{ show: boolean }>();
const emit = defineEmits<{
  (e: "update:show", v: boolean): void;
}>();

const { t } = useI18n();
const message = useMessage();

const userId = ref("");
const text = ref("");
const sending = ref(false);

watch(
  () => props.show,
  (visible) => {
    if (visible) {
      userId.value = "";
      text.value = "";
    }
  },
);

async function handleSend() {
  if (!userId.value.trim()) {
    message.warning(t("channel.wechat.userId"));
    return;
  }
  sending.value = true;
  try {
    const result = await api.wechatTest(userId.value.trim(), text.value.trim() || undefined);
    if (result.ok) {
      message.success(t("channel.wechat.testSent"));
      emit("update:show", false);
    } else {
      message.error(`${t("channel.testFailed")}: ${result.error ?? ""}`);
    }
  } catch (e: any) {
    message.error(e?.message ?? t("channel.testFailed"));
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <NModal :show="show" @update:show="(v: boolean) => emit('update:show', v)">
    <div class="dialog" @click.stop>
      <div class="dialog-header">
        <h3 class="dialog-title">{{ t('channel.wechat.testTitle') }}</h3>
        <button class="dialog-close" @click="emit('update:show', false)" :disabled="sending">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
          </svg>
        </button>
      </div>

      <div class="dialog-body">
        <label class="field">
          <span class="label">{{ t('channel.wechat.userId') }} <span class="required">*</span></span>
          <NInput
            v-model:value="userId"
            size="small"
            :placeholder="t('channel.wechat.userIdPlaceholder')"
          />
        </label>
        <label class="field">
          <span class="label">{{ t('channel.wechat.testText') }}</span>
          <NInput
            v-model:value="text"
            size="small"
            :placeholder="t('channel.wechat.testDefaultText')"
          />
        </label>
        <p class="hint">{{ t('channel.wechat.consentHint') }}</p>
      </div>

      <div class="dialog-actions">
        <button class="btn-cancel" @click="emit('update:show', false)" :disabled="sending">
          {{ t('channel.cancel') }}
        </button>
        <button class="btn-save" :disabled="sending || !userId.trim()" @click="handleSend">
          <span v-if="sending" class="btn-spinner" />
          {{ t('channel.test') }}
        </button>
      </div>
    </div>
  </NModal>
</template>

<style scoped>
.dialog {
  width: 480px;
  max-width: 90vw;
  max-height: 85vh;
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
.dialog-close:hover:not(:disabled) { background: var(--bg-hover); color: var(--text-primary); }
.dialog-close:disabled { opacity: 0.4; cursor: not-allowed; }

.dialog-body {
  padding: 4px 20px 12px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
  flex: 1;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.label {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  color: var(--text-faint);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.required {
  color: var(--rose);
}

.hint {
  font-size: 12px;
  color: var(--text-muted);
  margin: 0;
  line-height: 1.5;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 8px 20px 16px;
  flex-shrink: 0;
}

.btn-cancel, .btn-save {
  padding: 7px 18px;
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.btn-cancel {
  border: 1px solid var(--border-default);
  background: transparent;
  color: var(--text-muted);
}
.btn-cancel:hover:not(:disabled) {
  border-color: var(--text-muted);
  color: var(--text-primary);
}
.btn-cancel:disabled { opacity: 0.4; cursor: not-allowed; }

.btn-save {
  border: none;
  background: var(--accent);
  color: var(--bg-void);
}
.btn-save:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-save:not(:disabled):hover { filter: brightness(1.1); }

.btn-spinner {
  width: 12px;
  height: 12px;
  border: 1.5px solid rgba(0, 0, 0, 0.3);
  border-top-color: var(--bg-void);
  border-radius: 50%;
  display: inline-block;
  margin-right: 6px;
  vertical-align: middle;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
