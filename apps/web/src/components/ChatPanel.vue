<script setup lang="ts">
import { ref, computed, onMounted, nextTick, watch } from "vue";
import { NInput } from "naive-ui";
import { useAgentStore, partsFromPersisted } from "../stores/agent.js";
import { api } from "../api/client.js";
import { useI18n } from "../i18n/index.js";
import SkillSelect from "./SkillSelect.vue";
import ImportSkillDialog from "./ImportSkillDialog.vue";
import { useSkillStore } from "../stores/skill.js";
import type { MessagePart } from "@pi-web-ui/shared";
import { renderMarkdown } from "../utils/markdown.js";

const props = defineProps<{ sessionId: string }>();
const agent = useAgentStore();
const { t } = useI18n();
const skillStore = useSkillStore();
const showImportSkill = ref(false);
const input = ref("");
const messagesEl = ref<HTMLElement | null>(null);

const messages = computed(() => agent.messagesFor(props.sessionId));
const persistedMessages = ref<{ id: string; role: string; content: string | null; metadata: Record<string, unknown> | null; createdAt: number }[]>([]);

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
watch(
  () => JSON.stringify(messages.value.map((m) => m.parts.length)),
  () => nextTick(scrollToBottom),
);

function scrollToBottom() {
  if (messagesEl.value) {
    messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
  }
}

function formatJson(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}

function truncate(value: string, limit = 180): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}…` : normalized;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatTimeFull(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });
}

function toolPreview(name: string, args: unknown): string {
  if (!args || typeof args !== "object") return truncate(formatJson(args));
  const value = args as Record<string, unknown>;
  if (typeof value.command === "string") return `$ ${truncate(value.command)}`;
  if (typeof value.path === "string") return truncate(value.path);
  if (typeof value.query === "string") return truncate(value.query);
  if (typeof value.url === "string") return truncate(value.url);
  return truncate(formatJson(args));
}

function toolResultText(result: unknown): string {
  if (typeof result === "string") return result;
  if (Array.isArray(result)) return result.map(toolResultText).join("\n");
  if (result && typeof result === "object") {
    const value = result as Record<string, unknown>;
    if (typeof value.content === "string") return value.content;
    if (Array.isArray(value.content)) {
      const text = value.content
        .filter((part): part is { text: string } => !!part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string")
        .map((part) => part.text)
        .join("\n");
      if (text) return text;
    }
  }
  return formatJson(result);
}

function send() {
  if (!input.value.trim()) return;
  agent.send(props.sessionId, input.value);
  input.value = "";
  nextTick(scrollToBottom);
}

function onSkillSelect(name: string) {
  const cur = input.value;
  if (cur.length > 0 && !/\s$/.test(cur)) {
    input.value = cur + " /skill:" + name + " ";
  } else {
    input.value = cur + "/skill:" + name + " ";
  }
  nextTick(() => {
    const el = document.querySelector<HTMLTextAreaElement>(".composer-input textarea");
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  });
}

async function onSkillCreate(data: { name: string; description: string; body: string }) {
  try {
    await skillStore.importSkill(data);
  } catch (e: any) {
    console.error("Failed to import skill:", e);
    alert(`${e.message}`);
  } finally {
    showImportSkill.value = false;
  }
}

function handleKeySend(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send();
  }
}

const allMessages = computed(() => {
  const persisted = persistedMessages.value.map((m) => ({
    id: m.id,
    role: m.role as "user" | "assistant",
    parts: partsFromPersisted(m.content, m.metadata),
    streaming: false,
    persisted: true,
    createdAt: m.createdAt,
  }));
  const live = messages.value.map((m) => ({
    id: m.id,
    role: m.role,
    parts: m.parts,
    streaming: m.status === "streaming",
    persisted: false,
    createdAt: m.createdAt,
  }));
  const all = [...persisted, ...live];
  // Show the AGENT header only on the first message of a consecutive assistant group.
  return all.map((m, i) => ({
    ...m,
    showHeader: m.role !== "assistant" || all[i - 1]?.role !== "assistant",
  }));
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
        :class="[m.role, { streaming: m.streaming, continued: !m.showHeader }]"
      >
        <div v-if="m.showHeader" class="msg-header">
          <span class="msg-glyph" :class="m.role" aria-hidden="true">
            <svg v-if="m.role === 'user'" width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M1.5 8.5L8.5 1.5M8.5 1.5H3M8.5 1.5V7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            <svg v-else width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M5 1L9 5L5 9L1 5Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" />
              <circle cx="5" cy="5" r="1.1" fill="currentColor" />
            </svg>
          </span>
          <span class="msg-role">{{ m.role === "user" ? t('chat.roleUser') : t('chat.roleAgent') }}</span>
          <span v-if="m.streaming" class="typing-dots">
            <span /><span /><span />
          </span>
        </div>
        <div class="msg-body">
          <template v-for="(p, pi) in m.parts" :key="pi">
            <div v-if="p.kind === 'text'" class="msg-content" v-html="renderMarkdown(p.text)"></div>
            <details v-else-if="p.kind === 'thinking'" class="thinking-trace">
              <summary class="thinking-summary">
                <span class="trace-gutter">·</span>{{ t('chat.thinking') }}
              </summary>
              <div class="thinking-text">{{ p.text }}</div>
            </details>
            <div v-else-if="p.kind === 'tool_call'" class="tool-trace" :class="{ running: p.status === 'running' }">
              <details>
                <summary class="tool-summary">
                  <span class="trace-gutter">›</span>
                  <span class="tool-name">{{ p.name }}</span>
                  <span class="tool-preview">{{ toolPreview(p.name, p.args) }}</span>
                  <span class="tool-status" :class="p.status === 'running' ? 'running' : 'done'">
                    {{ p.status === 'running' ? t('chat.toolRunning') : t('chat.toolDone') }}
                  </span>
                </summary>
                <div class="tool-detail">
                  <div class="tool-section">
                    <div class="tool-label">{{ t('chat.toolArgs') }}</div>
                    <pre class="tool-code">{{ formatJson(p.args) }}</pre>
                  </div>
                  <div v-if="p.progress && p.progress.length" class="tool-section">
                    <div class="tool-label">{{ t('chat.toolProgress') }}</div>
                    <pre class="tool-code">{{ formatJson(p.progress) }}</pre>
                  </div>
                  <div v-if="p.result !== undefined" class="tool-section">
                    <div class="tool-label">{{ t('chat.toolResult') }}</div>
                    <pre class="tool-code">{{ toolResultText(p.result) }}</pre>
                  </div>
                </div>
              </details>
              <pre v-if="p.result !== undefined" class="tool-output">{{ truncate(toolResultText(p.result), 280) }}</pre>
              <div v-else-if="p.status === 'running'" class="tool-running-line"><span />{{ t('chat.toolRunning') }}</div>
            </div>
            <details v-else-if="p.kind === 'raw'" class="raw-trace">
              <summary class="raw-summary">
                <span class="trace-gutter">·</span><span class="raw-type">{{ String(p.data?.type ?? 'event') }}</span>
              </summary>
              <pre class="tool-code">{{ formatJson(p.data) }}</pre>
            </details>
          </template>
        </div>
        <div
          v-if="m.createdAt"
          class="msg-time"
          :class="m.role"
          :title="formatTimeFull(m.createdAt)"
        >{{ formatTime(m.createdAt) }}</div>
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
      <SkillSelect
        @select="onSkillSelect"
        @import="showImportSkill = true"
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
    <ImportSkillDialog
      data-test="import-skill-dialog"
      :show="showImportSkill"
      @close="showImportSkill = false"
      @create="onSkillCreate"
    />
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
  position: relative;
  max-width: 80%;
  padding: 10px 14px;
  border-radius: var(--radius-lg);
}

/* User ─ a warm amber "transmission capsule", right-aligned with a snubbed tail */
.msg.user {
  align-self: flex-end;
  background:
    linear-gradient(135deg, var(--amber-dim), transparent 60%),
    var(--chat-user-bg);
  border: 1px solid var(--chat-user-border);
  border-bottom-right-radius: 2px;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.04),
    0 8px 22px rgba(0, 0, 0, 0.26);
  animation: msgInRight 0.3s var(--ease-out) both;
  /* reserve space for the absolutely-positioned timestamp floating below the bubble */
  margin-bottom: 8px;
}

/* a small amber corner mark accenting the tail */
.msg.user::after {
  content: "";
  position: absolute;
  right: 8px;
  bottom: 5px;
  width: 5px;
  height: 5px;
  border-right: 1px solid var(--amber);
  border-bottom: 1px solid var(--amber);
  border-bottom-right-radius: 1px;
  opacity: 0.45;
}

/* Assistant ─ a cool, unbubbled column anchored by a signature teal gradient rail */
.msg.assistant {
  align-self: flex-start;
  max-width: min(880px, 90%);
  padding: 8px 4px 12px 16px;
  border-radius: 0;
  animation: msgInLeft 0.3s var(--ease-out) both;
}

.msg.assistant::before {
  content: "";
  position: absolute;
  left: 0;
  top: 10px;
  bottom: 10px;
  width: 2px;
  border-radius: 2px;
  background: linear-gradient(
    to bottom,
    var(--accent) 0%,
    rgba(0, 221, 179, 0.45) 35%,
    rgba(0, 221, 179, 0.08) 100%
  );
}

.msg.assistant.continued {
  margin-top: -4px;
}

/* chain consecutive assistant rails into a continuous line */
.msg.assistant.continued::before {
  top: 0;
  bottom: 10px;
  opacity: 0.5;
}

.msg.streaming.assistant::before {
  animation: railPulse 1.8s ease-in-out infinite;
}

@keyframes railPulse {
  0%, 100% { opacity: 0.55; box-shadow: 0 0 0 transparent; }
  50%      { opacity: 1;    box-shadow: 0 0 10px var(--accent-glow); }
}

@keyframes msgInRight {
  from { opacity: 0; transform: translateX(6px)  translateY(2px); }
  to   { opacity: 1; transform: translateX(0)    translateY(0); }
}

@keyframes msgInLeft {
  from { opacity: 0; transform: translateX(-6px) translateY(2px); }
  to   { opacity: 1; transform: translateX(0)   translateY(0); }
}

/* ─── Message Header ─── */

.msg-header {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 5px;
}

.msg-glyph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

.msg.user .msg-glyph      { color: var(--amber); }
.msg.assistant .msg-glyph { color: var(--accent); }

.msg-role {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.12em;
}

.msg.user .msg-role      { color: var(--amber); }
.msg.assistant .msg-role { color: var(--text-secondary); }

/* a hairline rule between the role label and the time, like a metadata divider */
/* ─── Message Time (below the body, role-aligned) ─── */

.msg-time {
  margin-top: 5px;
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.04em;
  line-height: 1.2;
  white-space: nowrap;
  opacity: 0.7;
}

/* User timestamp floats below the bubble, right-aligned to its right edge —
   the bubble shrinks to body width instead of expanding to fit the timestamp. */
.msg.user .msg-time {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 4px;
  text-align: right;
  color: var(--amber);
}

.msg.assistant .msg-time {
  text-align: left;
  color: var(--text-secondary);
}

/* ─── Typing Indicator ─── */

.typing-dots {
  display: flex;
  gap: 3px;
  align-items: center;
  margin-left: 2px;
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
  font-size: 13.5px;
  line-height: 1.65;
  letter-spacing: 0.005em;
  color: var(--text-primary);
  overflow-wrap: anywhere;
}

.msg.user .msg-content {
  color: var(--text-primary);
}

/* ─── Rendered Markdown ─── */

.msg-content :deep(p) {
  margin: 0 0 0.6em;
}
.msg-content :deep(p:last-child),
.msg-content :deep(*:last-child) {
  margin-bottom: 0;
}
.msg-content :deep(*:first-child) {
  margin-top: 0;
}

.msg-content :deep(h1),
.msg-content :deep(h2),
.msg-content :deep(h3),
.msg-content :deep(h4),
.msg-content :deep(h5),
.msg-content :deep(h6) {
  font-family: var(--font-sans);
  font-weight: 600;
  line-height: 1.3;
  color: var(--text-primary);
}
.msg-content :deep(h1) {
  font-size: 1.45em;
  margin: 1.2em 0 0.5em;
  padding-bottom: 0.25em;
  border-bottom: 1px solid var(--border-default);
}
.msg-content :deep(h2) {
  font-size: 1.25em;
  margin: 1.1em 0 0.5em;
  padding-bottom: 0.22em;
  border-bottom: 1px solid var(--border-subtle);
}
.msg-content :deep(h3) { font-size: 1.1em;  margin: 1em 0 0.4em; }
.msg-content :deep(h4) { font-size: 1em;    margin: 0.9em 0 0.4em; }
.msg-content :deep(h5),
.msg-content :deep(h6) {
  font-size: 0.95em;
  margin: 0.8em 0 0.4em;
  color: var(--text-secondary);
}

.msg-content :deep(a) {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 2px;
  text-decoration-color: var(--accent-dim);
  text-decoration-thickness: 1px;
  transition: text-decoration-color var(--transition-fast), color var(--transition-fast);
}
.msg-content :deep(a:hover) {
  text-decoration-color: var(--accent);
  color: var(--accent-hover);
}

.msg-content :deep(strong) { font-weight: 700; color: var(--text-primary); }
.msg-content :deep(em)     { font-style: italic; }
.msg-content :deep(del)    { color: var(--text-muted); }

.msg-content :deep(ul),
.msg-content :deep(ol) {
  margin: 0.3em 0 0.7em;
  padding-left: 1.4em;
}
.msg-content :deep(li) {
  margin: 0.15em 0;
}
.msg-content :deep(li::marker) {
  color: var(--accent);
  font-family: var(--font-mono);
}
.msg-content :deep(li p) { margin: 0 0 0.3em; }

.msg-content :deep(blockquote) {
  margin: 0.4em 0 0.8em;
  padding: 0.2em 0 0.2em 14px;
  border-left: 2px solid var(--accent);
  color: var(--text-secondary);
  font-style: italic;
}
.msg-content :deep(blockquote p) { margin: 0 0 0.3em; }

.msg-content :deep(code) {
  font-family: var(--font-mono);
  font-size: 0.88em;
  padding: 1.5px 5px;
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  color: var(--text-primary);
}

.msg-content :deep(pre) {
  margin: 0.4em 0 0.85em;
  padding: 10px 12px;
  background: var(--bg-void);
  border: 1px solid var(--border-default);
  border-left: 2px solid var(--accent);
  border-radius: var(--radius-sm);
  overflow-x: auto;
  font-size: 12px;
  line-height: 1.5;
}
.msg-content :deep(pre code) {
  background: transparent;
  border: none;
  padding: 0;
  font-size: 12px;
  color: var(--text-primary);
}

.msg-content :deep(table) {
  border-collapse: collapse;
  margin: 0.4em 0 0.85em;
  font-size: 12.5px;
  display: block;
  overflow-x: auto;
  max-width: 100%;
}
.msg-content :deep(thead),
.msg-content :deep(tbody),
.msg-content :deep(tr) {
  display: table-row;
}
.msg-content :deep(th),
.msg-content :deep(td) {
  display: table-cell;
  padding: 6px 10px;
  border: 1px solid var(--border-default);
  text-align: left;
  vertical-align: top;
}
.msg-content :deep(th) {
  background: var(--bg-elevated);
  font-weight: 600;
  color: var(--text-primary);
}
.msg-content :deep(td) {
  color: var(--text-secondary);
}

.msg-content :deep(hr) {
  border: none;
  height: 1px;
  margin: 1em 0;
  background: linear-gradient(to right, transparent, var(--border-active) 20%, var(--border-active) 80%, transparent);
}

.msg-content :deep(img) {
  max-width: 100%;
  border-radius: var(--radius-sm);
  vertical-align: middle;
}

/* ─── Message Body (parts) ─── */

.msg-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* ─── Agent trace (Claude Code / Pi CLI-inspired) ─── */

.thinking-trace,
.raw-trace,
.tool-trace {
  margin: 1px 0;
  font-size: 12px;
}

.thinking-summary {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 4px 0;
  cursor: pointer;
  user-select: none;
  list-style: none;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
}

.thinking-summary::-webkit-details-marker {
  display: none;
}

.thinking-text {
  margin: 3px 0 8px 14px;
  padding: 2px 0 2px 12px;
  border-left: 1px solid var(--border-default);
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-muted);
  font-style: italic;
  white-space: pre-wrap;
  word-break: break-word;
}

.raw-summary {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 4px 0;
  cursor: pointer;
  user-select: none;
  list-style: none;
}

.raw-summary::-webkit-details-marker {
  display: none;
}

.raw-type {
  font-family: var(--font-mono);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-faint, var(--text-muted));
}

.trace-gutter {
  display: inline-flex;
  width: 12px;
  justify-content: center;
  color: var(--text-faint, var(--text-muted));
  font-family: var(--font-mono);
  font-size: 15px;
  line-height: 1;
}

.tool-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 5px 0;
  cursor: pointer;
  user-select: none;
  list-style: none;
}

.tool-summary::-webkit-details-marker {
  display: none;
}

.tool-icon {
  font-size: 12px;
  opacity: 0.8;
}

.tool-name {
  font-family: var(--font-mono);
  font-weight: 600;
  color: var(--text-primary);
  flex-shrink: 0;
}

.tool-preview {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 11px;
}

.tool-status {
  margin-left: auto;
  flex-shrink: 0;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.tool-status.running {
  color: var(--accent);
}

.tool-status.done {
  color: var(--text-faint, var(--text-muted));
}

.tool-detail {
  margin: 2px 0 7px 14px;
  padding: 7px 0 7px 12px;
  border-left: 1px solid var(--border-default);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.tool-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tool-label {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
}

.tool-code {
  margin: 0;
  padding: 7px 9px;
  background: var(--bg-void, rgba(0, 0, 0, 0.035));
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 280px;
  overflow-y: auto;
}

.tool-output {
  margin: 0 0 6px 20px;
  padding: 6px 10px;
  border-left: 2px solid var(--border-default);
  color: var(--text-muted);
  background: transparent;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.tool-running-line {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0 0 6px 20px;
  color: var(--accent);
  font-family: var(--font-mono);
  font-size: 11px;
}

.tool-running-line span {
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background: currentColor;
  animation: tracePulse 1.1s ease-in-out infinite;
}

@keyframes tracePulse {
  50% { opacity: 0.25; transform: scale(0.7); }
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
