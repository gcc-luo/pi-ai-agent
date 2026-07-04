<script setup lang="ts">
import { ref, computed, onMounted, nextTick, watch } from "vue";
import { NInput, NButton } from "naive-ui";
import { useAgentStore } from "../stores/agent.js";
import { api } from "../api/client.js";
import { useI18n } from "../i18n/index.js";

const props = defineProps<{ sessionId: string }>();
const agent = useAgentStore();
const { t } = useI18n();
const input = ref("");
const messagesEl = ref<HTMLElement | null>(null);

const messages = computed(() => agent.messagesFor(props.sessionId));
const persistedMessages = ref<{ id: string; role: string; content: string | null }[]>([]);

async function loadMessages() {
  persistedMessages.value = await api.listMessages(props.sessionId);
  await nextTick();
  scrollToBottom();
}

onMounted(loadMessages);
watch(() => props.sessionId, loadMessages);

watch(
  () => messages.value.length,
  () => nextTick(scrollToBottom),
);

function scrollToBottom() {
  if (messagesEl.value) {
    messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
  }
}

function send() {
  if (!input.value.trim()) return;
  agent.send(props.sessionId, input.value);
  input.value = "";
  nextTick(scrollToBottom);
}

function handleKeySend(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send();
  }
}

function isStreaming(msgId: string) {
  return messages.value.find((m) => m.id === msgId)?.status === "streaming";
}

const allMessages = computed(() => {
  const persisted = persistedMessages.value.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content ?? "",
    streaming: false,
    persisted: true,
  }));
  const live = messages.value.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    streaming: m.status === "streaming",
    persisted: false,
  }));
  return [...persisted, ...live];
});

const sessionErrors = computed(() =>
  agent.errors.filter((e) => e.sessionId === props.sessionId),
);
</script>

<template>
  <div class="chat-panel">
    <!-- Error Banner -->
    <div v-if="sessionErrors.length" class="error-banner">
      <div v-for="(err, i) in sessionErrors" :key="i" class="error-item">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <circle cx="7" cy="7" r="6" stroke="currentColor" stroke-width="1.3" />
          <path d="M7 4v3.5M7 9.5v.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
        </svg>
        <span class="error-text">{{ err.message }}</span>
        <button class="error-dismiss" @click="agent.dismissError(agent.errors.indexOf(err))">&times;</button>
      </div>
    </div>

    <!-- Messages -->
    <div class="messages" ref="messagesEl">
      <div v-if="!allMessages.length" class="empty-state">
        <div class="empty-icon">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <path
              d="M4 8a4 4 0 014-4h12a4 4 0 014 4v8a4 4 0 01-4 4h-4.5L10 23v-3H8a4 4 0 01-4-4V8z"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linejoin="round"
            />
            <path d="M9 11h10M9 14h6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
          </svg>
        </div>
        <p class="empty-text">{{ t('chat.empty') }}</p>
      </div>

      <div
        v-for="m in allMessages"
        :key="m.id"
        class="msg"
        :class="[m.role, { streaming: m.streaming }]"
      >
        <div class="msg-header">
          <span class="msg-role">{{ m.role === "user" ? t('chat.roleUser') : t('chat.roleAgent') }}</span>
          <span v-if="m.streaming" class="typing-dots">
            <span /><span /><span />
          </span>
        </div>
        <div class="msg-content">{{ m.content }}</div>
      </div>
    </div>

    <!-- Composer -->
    <div class="composer">
      <NInput
        v-model:value="input"
        type="textarea"
        :rows="2"
        :autosize="{ minRows: 2, maxRows: 5 }"
        :placeholder="t('chat.placeholder')"
        @keydown="handleKeySend"
        class="composer-input"
      />
      <button
        class="send-btn"
        :disabled="!input.trim()"
        @click="send"
        :title="t('chat.send')"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path
            d="M2 9l14-7-7 14V9H2z"
            fill="currentColor"
          />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.chat-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

/* ─── Error Banner ─── */

.error-banner {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 14px;
  background: var(--rose-dim);
  border-bottom: 1px solid var(--rose);
}

.error-item {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--rose);
  font-size: 12px;
  line-height: 1.4;
}

.error-text {
  flex: 1;
  min-width: 0;
  word-break: break-word;
}

.error-dismiss {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--rose);
  font-size: 14px;
  cursor: pointer;
  opacity: 0.6;
  transition: opacity var(--transition-fast);
}
.error-dismiss:hover {
  opacity: 1;
  background: rgba(239, 68, 68, 0.15);
}

/* ─── Messages ─── */

.messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* ─── Empty State ─── */

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  gap: 12px;
  animation: fadeIn 0.4s var(--ease-out) both;
}

.empty-icon {
  color: var(--text-faint);
  opacity: 0.5;
}

.empty-text {
  font-size: 13px;
  color: var(--text-muted);
}

/* ─── Message Bubbles ─── */

.msg {
  max-width: 80%;
  padding: 10px 14px;
  border-radius: var(--radius-lg);
  animation: fadeIn 0.25s var(--ease-out) both;
}

.msg.user {
  align-self: flex-end;
  background: var(--chat-user-bg);
  border: 1px solid var(--chat-user-border);
  border-bottom-right-radius: var(--radius-sm);
}

.msg.assistant {
  align-self: flex-start;
  background: var(--chat-assistant-bg);
  border: 1px solid var(--chat-assistant-border);
  border-bottom-left-radius: var(--radius-sm);
}

.msg.streaming {
  border-color: var(--accent-dim);
}

/* ─── Message Header ─── */

.msg-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.msg-role {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.msg.user .msg-role {
  color: var(--accent);
}

.msg.assistant .msg-role {
  color: var(--amber);
}

/* ─── Typing Indicator ─── */

.typing-dots {
  display: flex;
  gap: 3px;
  align-items: center;
}

.typing-dots span {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--accent);
  animation: dotBounce 1.2s ease infinite;
}
.typing-dots span:nth-child(2) {
  animation-delay: 0.15s;
}
.typing-dots span:nth-child(3) {
  animation-delay: 0.3s;
}

/* ─── Message Content ─── */

.msg-content {
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-word;
}

.msg.user .msg-content {
  color: var(--text-primary);
}

/* ─── Composer ─── */

.composer {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 12px 20px 16px;
  border-top: 1px solid var(--border-default);
  background: var(--bg-surface);
  flex-shrink: 0;
}

.composer-input {
  flex: 1;
}

.send-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: var(--radius-md);
  border: none;
  background: var(--accent);
  color: var(--bg-void);
  cursor: pointer;
  transition: all var(--transition-fast);
  flex-shrink: 0;
}
.send-btn:hover:not(:disabled) {
  background: var(--accent-hover);
  box-shadow: var(--shadow-glow);
  transform: translateY(-1px);
}
.send-btn:active:not(:disabled) {
  background: var(--accent-pressed);
  transform: translateY(0);
}
.send-btn:disabled {
  opacity: 0.25;
  cursor: not-allowed;
}
</style>
