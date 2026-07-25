<script setup lang="ts">
import { ref, computed, onMounted, nextTick, watch } from "vue";
import { NInput } from "naive-ui";
import { useAgentStore, partsFromPersisted } from "../stores/agent.js";
import { api } from "../api/client.js";
import { useI18n } from "../i18n/index.js";
import SkillSelect from "./SkillSelect.vue";
import ImportSkillDialog from "./ImportSkillDialog.vue";
import { useSkillStore } from "../stores/skill.js";
import ChatKbPicker from "./ChatKbPicker.vue";
import ChatExpertPicker from "./ChatExpertPicker.vue";
import { activeTipBody, activeTipLabel } from "../utils/skill-tips.js";
import type { MessagePart } from "@pi-web-ui/shared";

const props = defineProps<{
  sessionId: string;
  projectId: string;
}>();
const emit = defineEmits<{ (e: "select-file", path: string): void }>();

const agent = useAgentStore();
const { t } = useI18n();
const skillStore = useSkillStore();

const input = ref("");
const messagesEl = ref<HTMLElement | null>(null);
const fileInputEl = ref<HTMLInputElement | null>(null);
const showImportSkill = ref(false);
const selectedSkills = ref<string[]>([]);

// ─── File attachment ───

interface AttachedFile {
  name: string;
  ext: string;
  content: string;
  size: number;
}
const attachedFiles = ref<AttachedFile[]>([]);

const MAX_FILE_SIZE = 1024 * 1024; // 1MB
const TEXT_EXTS = new Set([
  "txt", "md", "markdown", "json", "yaml", "yml", "csv", "tsv", "log",
  "js", "ts", "tsx", "jsx", "vue", "py", "rb", "go", "rs", "java", "kt",
  "c", "h", "cpp", "hpp", "cs", "php", "swift", "sh", "bash", "zsh",
  "html", "htm", "css", "scss", "less", "xml", "svg", "toml", "ini",
  "conf", "env", "sql", "graphql", "proto", "dart",
]);
const TEXT_EXTS_ACCEPT = Array.from(TEXT_EXTS).map((e) => `.${e}`).join(",");

// ─── Image attachment ───

interface AttachedImage {
  name: string;
  mediaType: string;
  data: string;      // base64 (no data: URI prefix)
  size: number;
  previewUrl: string; // data URL for <img> src
}
const attachedImages = ref<AttachedImage[]>([]);

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp"]);
const IMAGE_MEDIA_TYPES: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", webp: "image/webp",
};
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_IMAGE_COUNT = 5;
const IMAGE_EXTS_ACCEPT = Array.from(IMAGE_EXTS).map((e) => `.${e}`).join(",");
const ALL_EXTS_ACCEPT = `${TEXT_EXTS_ACCEPT},${IMAGE_EXTS_ACCEPT}`;

function triggerFilePick() {
  fileInputEl.value?.click();
}

function onFilePicked(e: Event) {
  const target = e.target as HTMLInputElement;
  const files = target.files;
  if (!files) return;
  for (const file of Array.from(files)) {
    const ext = (file.name.split(".").pop() ?? "").toLowerCase();

    // Image file path
    if (IMAGE_EXTS.has(ext)) {
      if (attachedImages.value.length >= MAX_IMAGE_COUNT) {
        alert(t("chat.tooManyImages") + ` (max ${MAX_IMAGE_COUNT})`);
        break;
      }
      if (file.size > MAX_IMAGE_SIZE) {
        alert(t("chat.imageTooLarge") + `: ${file.name}`);
        continue;
      }
      readImageFile(file);
      continue;
    }

    // Text file path
    if (!TEXT_EXTS.has(ext)) {
      alert(t("chat.fileUnsupported") + `: ${file.name}`);
      continue;
    }
    if (file.size > MAX_FILE_SIZE) {
      alert(t("chat.fileTooLarge") + `: ${file.name}`);
      continue;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const content = typeof reader.result === "string" ? reader.result : "";
      attachedFiles.value = [
        ...attachedFiles.value,
        { name: file.name, ext, content, size: file.size },
      ];
    };
    reader.onerror = () => {
      console.error("Failed to read file:", file.name, reader.error);
    };
    reader.readAsText(file);
  }
  // Reset input so same file can be picked again later
  target.value = "";
}

function readImageFile(file: File) {
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = typeof reader.result === "string" ? reader.result : "";
    const commaIdx = dataUrl.indexOf(",");
    if (commaIdx < 0) return;
    const base64Data = dataUrl.slice(commaIdx + 1);
    const mediaType = IMAGE_MEDIA_TYPES[(file.name.split(".").pop() ?? "").toLowerCase()] ?? "image/png";
    attachedImages.value = [
      ...attachedImages.value,
      { name: file.name, mediaType, data: base64Data, size: file.size, previewUrl: dataUrl },
    ];
  };
  reader.onerror = () => {
    console.error("Failed to read image:", file.name, reader.error);
  };
  reader.readAsDataURL(file);
}

function removeAttachedFile(idx: number) {
  attachedFiles.value = attachedFiles.value.filter((_, i) => i !== idx);
}

function removeAttachedImage(idx: number) {
  attachedImages.value = attachedImages.value.filter((_, i) => i !== idx);
}

function handlePaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of Array.from(items)) {
    if (item.type.startsWith("image/")) {
      e.preventDefault();
      if (attachedImages.value.length >= MAX_IMAGE_COUNT) {
        alert(t("chat.tooManyImages") + ` (max ${MAX_IMAGE_COUNT})`);
        return;
      }
      const blob = item.getAsFile();
      if (!blob) continue;
      const ext = item.type.split("/")[1] ?? "png";
      const name = `screenshot-${Date.now()}.${ext === "jpeg" ? "jpg" : ext}`;
      readImageFile(new File([blob], name, { type: item.type }));
    }
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Data ───

const persistedMessages = ref<Awaited<ReturnType<typeof api.listMessages>>>([]);
const messages = computed(() => agent.messagesFor(props.sessionId));
const isBusy = computed(() => agent.isSessionBusy(props.sessionId));

async function loadMessages() {
  persistedMessages.value = await api.listMessages(props.sessionId);
  // Seed token counters from persisted metadata
  let historicalInput = 0;
  let historicalOutput = 0;
  for (const m of persistedMessages.value) {
    const usage = (m.metadata as Record<string, unknown> | null)?.usage as { input?: number; output?: number } | undefined;
    if (usage) {
      historicalInput += usage.input ?? 0;
      historicalOutput += usage.output ?? 0;
    }
  }
  agent.sessionTokens[props.sessionId] = { input: historicalInput, output: historicalOutput };
  await nextTick();
  scrollToBottom();
}

const allMessages = computed(() => {
  const persisted = persistedMessages.value.map((m) => ({
    id: m.id,
    role: m.role as "user" | "assistant",
    parts: partsFromPersisted(m.content, m.metadata),
    streaming: false,
    createdAt: m.createdAt,
  }));
  const live = messages.value.map((m) => ({
    id: m.id,
    role: m.role,
    parts: m.parts,
    streaming: m.status === "streaming",
    createdAt: m.createdAt,
  }));
  return [...persisted, ...live];
});

onMounted(async () => {
  await loadMessages();
});

watch(() => props.sessionId, async () => {
  await loadMessages();
});

watch(
  () => messages.value.length,
  () => nextTick(scrollToBottom),
);
watch(
  () => JSON.stringify(messages.value.map((m) => m.parts.length)),
  () => nextTick(scrollToBottom),
);

// ─── Scroll ───

function scrollToBottom() {
  if (messagesEl.value) {
    messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
  }
}

const showScrollButton = ref(false);

function onMessagesScroll() {
  const el = messagesEl.value;
  if (!el) return;
  const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
  showScrollButton.value = distanceFromBottom > 200;
}

function handleClickScrollToBottom() {
  const el = messagesEl.value;
  if (!el) return;
  el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
}

// ─── Token usage ───

const displayedInput = computed(() => agent.sessionTokens[props.sessionId]?.input ?? 0);
const displayedOutput = computed(() => agent.sessionTokens[props.sessionId]?.output ?? 0);

const tokenLabel = computed(() => {
  const fmt = (n: number) => {
    const rounded = Math.round(n);
    if (rounded <= 0) return "0";
    if (rounded >= 1000) return `${(rounded / 1000).toFixed(1)}K`;
    return String(rounded);
  };
  return { input: fmt(displayedInput.value), output: fmt(displayedOutput.value) };
});

// ─── Skill management ───

const pendingTipLabel = computed(() => {
  const key = activeTipLabel(selectedSkills.value);
  return key ? t(key) : null;
});

function onSkillSelect(name: string) {
  if (!selectedSkills.value.includes(name)) {
    selectedSkills.value = [...selectedSkills.value, name];
  }
  nextTick(() => {
    const el = document.querySelector<HTMLTextAreaElement>(".term-input textarea");
    el?.focus();
  });
}

function removeSkill(name: string) {
  selectedSkills.value = selectedSkills.value.filter((n) => n !== name);
}

// ─── Send ───

function send() {
  const text = input.value;
  const skills = selectedSkills.value;
  const files = attachedFiles.value;
  const images = attachedImages.value;
  if (!text.trim() && !skills.length && !files.length && !images.length) return;
  const skillSuffix = skills.map((n) => ` /skill:${n}`).join("");
  const tipPrefix = activeTipBody(skills) ?? "";
  const filePrefix = files.length
    ? files
        .map(
          (f) =>
            `\n\`\`\`${f.ext || "text"} title="${f.name}"\n${f.content}\n\`\`\`\n`,
        )
        .join("\n") + "\n"
    : "";
  const imageAttachments = images.length
    ? images.map((img) => ({ name: img.name, mediaType: img.mediaType, data: img.data }))
    : undefined;
  agent.send(props.sessionId, `${tipPrefix}${filePrefix}${text}${skillSuffix}`, imageAttachments);
  input.value = "";
  selectedSkills.value = [];
  attachedFiles.value = [];
  attachedImages.value = [];
  nextTick(scrollToBottom);
}

function handleKeySend(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    if (isBusy.value) {
      agent.interrupt(props.sessionId);
      return;
    }
    send();
  }
}

// ─── Tool call helpers ───

function toolSummary(name: string, args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const a = args as Record<string, unknown>;
  const lower = name.toLowerCase();
  // write / edit / create_file
  if (lower === "write" || lower === "write_file" || lower === "create_file") {
    return String(a.path ?? a.file_path ?? a.file ?? "");
  }
  if (lower === "edit" || lower === "edit_file") {
    return String(a.path ?? a.file_path ?? a.file ?? "");
  }
  if (lower === "read" || lower === "read_file") {
    return String(a.path ?? a.file_path ?? a.file ?? "");
  }
  if (lower === "bash" || lower === "shell" || lower === "execute_bash") {
    const cmd = String(a.command ?? "");
    return cmd.length > 60 ? cmd.slice(0, 57) + "..." : cmd;
  }
  if (lower === "search" || lower === "grep") {
    const pattern = String(a.pattern ?? a.query ?? "");
    const path = String(a.path ?? a.directory ?? "");
    return pattern ? `"${pattern}"${path ? ` in ${path}` : ""}` : "";
  }
  if (lower === "delete_file" || lower === "rm") {
    return String(a.path ?? a.file_path ?? "");
  }
  // Fallback: first string arg
  for (const v of Object.values(a)) {
    if (typeof v === "string" && v.length > 0) {
      return v.length > 60 ? v.slice(0, 57) + "..." : v;
    }
  }
  return "";
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
  try { return JSON.stringify(result, null, 2); } catch { return String(result); }
}

function formatJson(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}

// Render assistant text with minimal markdown (bold, inline code, links, file paths)
function renderCodingText(text: string): string {
  return text
    // Inline code
    .replace(/`([^`]+)`/g, '<code class="cd-inline-code">$1</code>')
    // Bold
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // Links [text](url)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" class="cd-link">$1</a>')
    // File paths (simple heuristic: word/word.ext)
    .replace(/\b((?:[\w.-]+\/)+[\w.-]+\.\w{1,5})\b/g, '<button class="cd-file-ref" data-path="$1">$1</button>')
    // Line breaks
    .replace(/\n/g, "<br>");
}

function onContentClick(e: MouseEvent) {
  const target = e.target as HTMLElement;
  if (target.classList.contains("cd-file-ref")) {
    const path = target.getAttribute("data-path");
    if (path) emit("select-file", path);
  }
}
</script>

<template>
  <div class="coding-panel">
    <!-- Message stream -->
    <div class="terminal-scroll" ref="messagesEl" @scroll="onMessagesScroll">
      <div class="terminal-stream">
        <div
          v-for="m in allMessages"
          :key="m.id"
          class="terminal-msg"
          :class="m.role"
        >
          <!-- Role header -->
          <div class="term-role">
            <span class="term-role-label">{{ m.role === 'user' ? 'user' : 'PI Agent' }}</span>
            <span v-if="m.streaming" class="term-working">
              <span class="term-dot" />
            </span>
          </div>

          <!-- Parts -->
          <template v-for="(p, pi) in m.parts" :key="pi">
            <!-- User text -->
            <div v-if="p.kind === 'text' && m.role === 'user'" class="term-user-text">
              <span class="term-prompt">&gt;</span>
              <span class="term-text-body">{{ p.text }}</span>
            </div>

            <!-- Assistant text -->
            <div
              v-else-if="p.kind === 'text'"
              class="term-assistant-text"
              @click="onContentClick"
              v-html="renderCodingText(p.text)"
            />

            <!-- Thinking (collapsed) -->
            <details v-else-if="p.kind === 'thinking'" class="term-thinking">
              <summary class="term-thinking-summary">
                <span class="term-gutter">·</span>
                <span>{{ t('coding.thinking') }}</span>
              </summary>
              <pre class="term-thinking-body">{{ p.text }}</pre>
            </details>

            <!-- Tool call (compact) -->
            <details v-else-if="p.kind === 'tool_call'" class="term-tool" :class="{ running: p.status === 'running' }">
              <summary class="term-tool-summary">
                <span class="term-gutter">›</span>
                <span class="term-tool-name">{{ p.name }}</span>
                <span class="term-tool-args">{{ toolSummary(p.name, p.args) }}</span>
                <span class="term-tool-status" :class="p.status">
                  {{ p.status === 'running' ? t('coding.toolRunning') : '✓' }}
                </span>
              </summary>
              <div class="term-tool-detail">
                <!-- Args -->
                <pre class="term-code">{{ formatJson(p.args) }}</pre>
                <!-- Progress -->
                <div v-if="p.progress && p.progress.length" class="term-progress">
                  <pre class="term-code">{{ formatJson(p.progress) }}</pre>
                </div>
                <!-- Result -->
                <pre v-if="p.result !== undefined" class="term-result">{{ toolResultText(p.result) }}</pre>
              </div>
            </details>

            <!-- Image -->
            <div v-else-if="p.kind === 'image'" class="term-image-ref">
              [image: {{ p.name }}]
            </div>

            <!-- Raw (hidden in coding mode) -->
          </template>
        </div>

        <!-- Generating indicator -->
        <div v-if="isBusy && !allMessages.some(m => m.streaming)" class="term-generating">
          <span class="term-dot" />
          <span>{{ t('coding.toolRunning') }}</span>
        </div>
      </div>

      <!-- Scroll to bottom button -->
      <button
        v-if="showScrollButton"
        class="term-scroll-btn"
        @click="handleClickScrollToBottom"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M7 2v10M3 8l4 4 4-4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
    </div>

    <!-- Input area -->
    <div class="term-composer">
      <!-- Tip banner -->
      <div v-if="pendingTipLabel" class="term-tip-banner">
        <span class="term-tip-icon">i</span>
        <span class="term-tip-label">{{ pendingTipLabel }}</span>
        <span class="term-tip-hint">{{ t('chat.tipAutoAttached') }}</span>
      </div>

      <!-- Skill chips -->
      <div v-if="selectedSkills.length" class="term-chips">
        <span v-for="name in selectedSkills" :key="name" class="term-chip skill">
          <span class="term-chip-icon">&#9670;</span>
          <span class="term-chip-name">{{ name }}</span>
          <button class="term-chip-remove" @click="removeSkill(name)">&times;</button>
        </span>
      </div>

      <!-- File chips -->
      <div v-if="attachedFiles.length" class="term-chips">
        <span v-for="(f, i) in attachedFiles" :key="f.name + i" class="term-chip file">
          <span class="term-chip-icon">&#128196;</span>
          <span class="term-chip-name">{{ f.name }}</span>
          <span class="term-chip-meta">{{ formatFileSize(f.size) }}</span>
          <button class="term-chip-remove" @click="removeAttachedFile(i)">&times;</button>
        </span>
      </div>

      <!-- Image preview chips -->
      <div v-if="attachedImages.length" class="term-chips images">
        <span v-for="(img, i) in attachedImages" :key="img.name + i" class="term-chip image">
          <img :src="img.previewUrl" :alt="img.name" class="term-image-thumb" />
          <button class="term-chip-remove" @click="removeAttachedImage(i)">&times;</button>
        </span>
      </div>

      <!-- Hidden file input -->
      <input
        ref="fileInputEl"
        type="file"
        multiple
        class="term-file-input"
        :accept="ALL_EXTS_ACCEPT"
        @change="onFilePicked"
      />

      <!-- Token usage -->
      <span class="token-usage" :title="'Token usage'">
        <span class="token-in"><span class="token-arrow">↑</span>{{ tokenLabel.input }}</span>
        <span class="token-out"><span class="token-arrow">↓</span>{{ tokenLabel.output }}</span>
      </span>

      <!-- Toolbar -->
      <div class="term-toolbar">
        <button class="term-tool-btn" :title="t('chat.upload')" @click="triggerFilePick">
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
            <path d="M7 9.5V2M4 4.5L7 1.5l3 3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
            <path d="M2 9v2.5a1 1 0 001 1h8a1 1 0 001-1V9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
          </svg>
        </button>
        <SkillSelect
          @select="onSkillSelect"
          @import="showImportSkill = true"
        />
        <ChatExpertPicker :session-id="sessionId" />
        <ChatKbPicker :session-id="sessionId" />
      </div>

      <!-- Input row -->
      <div class="term-input-wrap">
        <NInput
          v-model:value="input"
          type="textarea"
          :rows="2"
          :autosize="{ minRows: 2, maxRows: 6 }"
          :placeholder="t('coding.placeholder')"
          @keydown="handleKeySend"
          @paste="handlePaste"
          class="term-input"
        />
        <button
          v-if="isBusy"
          class="term-send-btn stop"
          @click="agent.interrupt(props.sessionId)"
          :title="t('coding.stop')"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <rect x="2" y="2" width="8" height="8" rx="1" fill="currentColor" />
          </svg>
        </button>
        <button
          v-else
          class="term-send-btn"
          :disabled="!input.trim() && !selectedSkills.length && !attachedFiles.length && !attachedImages.length"
          @click="send"
          :title="t('coding.send')"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M2 8l12-6-6 12V8H2z" fill="currentColor" />
          </svg>
        </button>
      </div>
    </div>

    <ImportSkillDialog
      :show="showImportSkill"
      @close="showImportSkill = false"
    />
  </div>
</template>

<style scoped>
.coding-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: var(--bg-deep);
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.55;
}

/* ─── Scroll area ─── */

.terminal-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  position: relative;
  padding: 16px 20px 8px;
}

.terminal-stream {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* ─── Message blocks ─── */

.terminal-msg {
  padding: 4px 0;
}

.term-role {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 2px;
}

.term-role-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
}

.term-working {
  display: flex;
  align-items: center;
}

.term-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent, #2dd4a8);
  animation: termPulse 1.4s ease infinite;
}

@keyframes termPulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}

/* ─── User text ─── */

.term-user-text {
  display: flex;
  gap: 8px;
  color: var(--text-primary);
  padding-left: 4px;
}

.term-prompt {
  color: var(--accent, #2dd4a8);
  font-weight: 700;
  flex-shrink: 0;
  user-select: none;
}

.term-text-body {
  white-space: pre-wrap;
  word-break: break-word;
}

/* ─── Assistant text ─── */

.term-assistant-text {
  color: var(--text-secondary);
  padding-left: 4px;
  white-space: pre-wrap;
  word-break: break-word;
}

.term-assistant-text :deep(.cd-inline-code) {
  background: var(--bg-elevated, rgba(255,255,255,0.06));
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 12px;
  color: var(--accent, #2dd4a8);
}

.term-assistant-text :deep(strong) {
  color: var(--text-primary);
  font-weight: 600;
}

.term-assistant-text :deep(.cd-link) {
  color: var(--accent, #2dd4a8);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.term-assistant-text :deep(.cd-file-ref) {
  background: none;
  border: none;
  padding: 0;
  color: var(--accent, #2dd4a8);
  font-family: inherit;
  font-size: inherit;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
  text-decoration-style: dashed;
}
.term-assistant-text :deep(.cd-file-ref:hover) {
  text-decoration-style: solid;
}

/* ─── Thinking ─── */

.term-thinking {
  margin: 2px 0;
}

.term-thinking-summary {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  color: var(--text-muted);
  font-style: italic;
  font-size: 12px;
  list-style: none;
  padding: 2px 0;
}
.term-thinking-summary::-webkit-details-marker { display: none; }

.term-gutter {
  color: var(--text-muted);
  font-style: normal;
  flex-shrink: 0;
}

.term-thinking-body {
  margin: 4px 0 0 16px;
  padding: 6px 10px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-muted);
  background: var(--bg-elevated, rgba(255,255,255,0.03));
  border-radius: 4px;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 200px;
  overflow-y: auto;
}

/* ─── Tool call ─── */

.term-tool {
  margin: 2px 0;
}

.term-tool-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  padding: 3px 0;
  list-style: none;
  color: var(--text-secondary);
}
.term-tool-summary::-webkit-details-marker { display: none; }

.term-tool-name {
  color: var(--accent, #2dd4a8);
  font-weight: 600;
  font-size: 12px;
  flex-shrink: 0;
  min-width: 60px;
}

.term-tool-args {
  color: var(--text-muted);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.term-tool-status {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
}
.term-tool-status.complete {
  color: var(--accent, #2dd4a8);
}
.term-tool-status.running {
  color: var(--amber, #f59e0b);
  animation: termPulse 1.4s ease infinite;
}

.term-tool-detail {
  margin: 4px 0 4px 16px;
  padding: 8px 12px;
  background: var(--bg-elevated, rgba(255,255,255,0.03));
  border-radius: 4px;
  border-left: 2px solid var(--border-subtle);
}

.term-code {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-muted);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 240px;
  overflow-y: auto;
}

.term-result {
  margin: 6px 0 0;
  padding-top: 6px;
  border-top: 1px solid var(--border-subtle);
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 300px;
  overflow-y: auto;
}

/* ─── Image ref ─── */

.term-image-ref {
  color: var(--text-muted);
  font-style: italic;
  font-size: 12px;
  padding: 2px 0;
}

/* ─── Generating ─── */

.term-generating {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 4px;
  color: var(--text-muted);
  font-size: 12px;
}

/* ─── Scroll button ─── */

.term-scroll-btn {
  position: absolute;
  bottom: 12px;
  right: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid var(--border-default);
  border-radius: 50%;
  background: var(--bg-surface);
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.15s;
  box-shadow: 0 2px 8px rgba(0,0,0,0.2);
}
.term-scroll-btn:hover {
  color: var(--text-primary);
  border-color: var(--accent);
}

/* ─── Composer ─── */

.term-composer {
  flex-shrink: 0;
  border-top: 1px solid var(--border-subtle);
  padding: 8px 20px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* ─── Tip banner ─── */

.term-tip-banner {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 4px;
  background: var(--bg-elevated, rgba(255,255,255,0.04));
  border: 1px solid var(--border-subtle);
  font-size: 11px;
  color: var(--text-muted);
}

.term-tip-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 1px solid var(--accent, #2dd4a8);
  color: var(--accent, #2dd4a8);
  font-size: 9px;
  font-weight: 700;
  font-style: italic;
  flex-shrink: 0;
}

.term-tip-label {
  color: var(--accent, #2dd4a8);
  font-weight: 600;
}

.term-tip-hint {
  color: var(--text-muted);
  font-size: 10px;
  margin-left: auto;
}

/* ─── Chips ─── */

.term-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.term-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 6px;
  border-radius: 3px;
  font-size: 11px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-elevated, rgba(255,255,255,0.04));
}

.term-chip.skill {
  border-color: color-mix(in srgb, var(--accent, #2dd4a8) 40%, var(--border-default));
  color: var(--accent, #2dd4a8);
}

.term-chip.file {
  color: var(--text-secondary);
}

.term-chip.image {
  padding: 2px;
  height: auto;
}

.term-chip-icon {
  font-size: 10px;
  flex-shrink: 0;
}

.term-chip-name {
  color: var(--text-primary);
  font-weight: 500;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.term-chip-meta {
  color: var(--text-muted);
  font-size: 10px;
}

.term-chip-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
  padding: 0;
  margin-left: 1px;
  transition: all 0.1s;
}
.term-chip-remove:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.term-image-thumb {
  width: 32px;
  height: 32px;
  border-radius: 3px;
  object-fit: cover;
}

/* ─── Hidden file input ─── */

.term-file-input {
  display: none;
}

/* ─── Token usage ─── */

.token-usage {
  display: flex;
  gap: 10px;
  font-size: 11px;
  color: var(--text-muted);
  font-family: var(--font-mono);
}
.token-arrow {
  margin-right: 2px;
}
.token-in { color: var(--accent, #2dd4a8); }
.token-out { color: var(--text-muted); }

/* ─── Toolbar ─── */

.term-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
}

.term-tool-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
  flex-shrink: 0;
}
.term-tool-btn:hover {
  border-color: var(--accent);
  color: var(--text-primary);
  background: var(--bg-hover);
}

/* ─── Input row ─── */

.term-input-wrap {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}

.term-input {
  flex: 1;
}
.term-input :deep(.n-input) {
  background: var(--bg-elevated, rgba(255,255,255,0.04)) !important;
  border: 1px solid var(--border-subtle) !important;
  border-radius: 6px !important;
  font-family: var(--font-mono) !important;
  font-size: 13px !important;
}
.term-input :deep(.n-input textarea) {
  font-family: var(--font-mono) !important;
}
.term-input :deep(.n-input--focus) {
  border-color: var(--accent, #2dd4a8) !important;
}

.term-send-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  border: 1px solid var(--border-default);
  border-radius: 6px;
  background: transparent;
  color: var(--accent, #2dd4a8);
  cursor: pointer;
  transition: all 0.15s;
}
.term-send-btn:hover:not(:disabled) {
  background: var(--accent, #2dd4a8);
  color: #fff;
  border-color: var(--accent, #2dd4a8);
}
.term-send-btn:disabled {
  opacity: 0.3;
  cursor: default;
}
.term-send-btn.stop {
  color: var(--rose, #ef4444);
  border-color: var(--rose, #ef4444);
}
.term-send-btn.stop:hover {
  background: var(--rose, #ef4444);
  color: #fff;
}
</style>
