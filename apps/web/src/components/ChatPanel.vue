<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from "vue";
import { NInput, NSelect } from "naive-ui";
import { useAgentStore, partsFromPersisted } from "../stores/agent.js";
import { api } from "../api/client.js";
import { useI18n } from "../i18n/index.js";
import SkillSelect from "./SkillSelect.vue";
import PluginSelect from "./PluginSelect.vue";
import ConnectorSelect from "./ConnectorSelect.vue";
import ImportSkillDialog from "./ImportSkillDialog.vue";
import { useSkillStore } from "../stores/skill.js";
import { useKbBindingStore } from "../stores/kb-binding.js";
import { useKbStore } from "../stores/kb.js";
import ChatKbPicker from "./ChatKbPicker.vue";
import ChatExpertPicker from "./ChatExpertPicker.vue";
import ChatKbBanner from "./ChatKbBanner.vue";
import ChatKbCallCard from "./ChatKbCallCard.vue";
import type { KbCallState } from "./ChatKbCallCard.vue";
import type {
  MessagePart,
  ArtifactItem,
  ArtifactValidation,
} from "@pi-web-ui/shared";
import { renderMarkdown } from "../utils/markdown.js";
import { TIP_BLOCK_RE, activeTipBody, activeTipLabel } from "../utils/skill-tips.js";
import { stripKbContext, getKbSearchMeta, renderKbCitations, type KbSearchMeta } from "../utils/kb-context.js";
import { parseArtifacts } from "../utils/artifacts.js";
import { summarizeTokenUsage } from "../utils/token-usage.js";
import TokenUsage from "./TokenUsage.vue";
import {
  annotateChatRuns,
  formatProcessingDuration,
  mergeChatMessageSources,
} from "../utils/chat-run-presentation.js";
import ArtifactCard from "./ArtifactCard.vue";
import ConfirmDialog from "./ConfirmDialog.vue";
import AgentActivity from "./AgentActivity.vue";

const props = defineProps<{ sessionId: string; projectId: string }>();
const emit = defineEmits<{ (e: "select-file", path: string): void; (e: "manage-connectors"): void }>();
const agent = useAgentStore();
const { t } = useI18n();
const skillStore = useSkillStore();
const kbBindingStore = useKbBindingStore();
const kbStore = useKbStore();
const showImportSkill = ref(false);
const input = ref("");
const selectedSkills = ref<string[]>([]);
const messagesEl = ref<HTMLElement | null>(null);
const fileInputEl = ref<HTMLInputElement | null>(null);

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

// ─── Image lightbox ───
const previewImage = ref<{ data: string; mediaType: string; name: string } | null>(null);

function openImagePreview(part: { name: string; mediaType: string; data: string }) {
  previewImage.value = { data: part.data, mediaType: part.mediaType, name: part.name };
}
function closeImagePreview() {
  previewImage.value = null;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Track kb_search states per user message — keyed by user message id
const kbSearchByMessage = ref<Record<string, KbCallState>>({});

// Watch agent store's kbSearches to assign to user messages
watch(
  () => agent.kbSearches[props.sessionId],
  (search) => {
    if (!search) return;
    // Find the last user message in the current messages
    const lastPersisted = [...persistedMessages.value].reverse().find((m) => m.role === "user");
    const lastLive = [...messages.value].reverse().find((m) => m.role === "user");
    const lastUser = lastLive ?? lastPersisted;
    if (lastUser) {
      const msgId = lastUser.id;
      kbSearchByMessage.value = {
        ...kbSearchByMessage.value,
        [msgId]: {
          phase: search.phase as KbCallState["phase"],
          query: search.query,
          hits: search.hits,
          durationMs: search.durationMs,
          error: search.error,
        },
      };
    }
  },
);

const messages = computed(() => agent.messagesFor(props.sessionId));
const pendingPermission = computed(() => agent.pendingPermissions[props.sessionId] ?? null);

// Pi can finish one assistant message to execute a tool and then start another
// model turn. Use the run lifecycle so the control remains in its stop state
// throughout that complete sequence.
const isBusy = computed(() => agent.isSessionBusy(props.sessionId));
const modelSelectOptions = computed(() =>
  agent.models.map((m) => ({ label: m.label, value: m.id })),
);
const expandedRunIds = ref<Set<string>>(new Set());
const durationClock = ref(Date.now());
const showScrollButton = ref(false);
const followLiveOutput = ref(true);
const newContentBelow = ref(false);
let durationTimer: number | null = null;

const activeElapsedMs = computed(() => {
  const startedAt = agent.runStartedAtFor(props.sessionId);
  return isBusy.value && startedAt !== null
    ? Math.max(0, durationClock.value - startedAt)
    : null;
});

function stopDurationTimer() {
  if (durationTimer !== null) {
    window.clearInterval(durationTimer);
    durationTimer = null;
  }
}

watch(
  isBusy,
  (busy) => {
    stopDurationTimer();
    if (!busy) return;
    durationClock.value = Date.now();
    durationTimer = window.setInterval(() => {
      durationClock.value = Date.now();
    }, 1000);
  },
  { immediate: true },
);

function toggleRun(runId: string | null, canToggle: boolean) {
  if (!runId || !canToggle) return;
  const next = new Set(expandedRunIds.value);
  if (next.has(runId)) next.delete(runId);
  else next.add(runId);
  expandedRunIds.value = next;
}

const compaction = computed(() => agent.compactionFor(props.sessionId));

function compactTokenCount(value?: number): string {
  if (value == null) return "";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
}

const compactionLabel = computed(() => {
  const state = compaction.value;
  if (!state) return "";
  if (state.phase === "started") return t("chat.compactionStarted");
  if (state.phase === "failed") return t("chat.compactionFailed");
  if (state.tokensBefore != null && state.estimatedTokensAfter != null) {
    return t("chat.compactionCompletedWithTokens", {
      before: compactTokenCount(state.tokensBefore),
      after: compactTokenCount(state.estimatedTokensAfter),
    });
  }
  return t("chat.compactionCompleted");
});

const knownSkillNames = computed(() => new Set(skillStore.skills.map((s) => s.name)));

/**
 * Strip `/skill:<name>` tokens the user picked from the dropdown out of the
 * visible text, returning the cleaned text plus the chip names to render.
 * Also strips any auto-injected skill-tip block (sentinel-wrapped) so the
 * user's bubble shows only what they typed — the tip is surfaced separately
 * via `tipLabel` so the user can still see *that* a tip was attached.
 * Only matches names that actually exist as installed skills so a stray
 * `/skill:foo` in code or prose is left untouched.
 */
function splitSkillsFromText(text: string): { text: string; skills: string[]; tipLabel: string | null; files: string[] } {
  const known = knownSkillNames.value;
  // Pull out the tip block first so it doesn't pollute the cleaned text.
  const tipMatch = text.match(/<!-- skill-tip:start -->/);
  let tipLabel: string | null = null;
  if (tipMatch) {
    // The body carries a 【...】 first line that names the skill — recover the
    // label from the first line so the badge reflects what was actually sent.
    const bodyMatch = text.match(/<!-- skill-tip:start -->\n([\s\S]*?)\n<!-- skill-tip:end -->/);
    if (bodyMatch) {
      const firstLine = (bodyMatch[1] ?? "").split("\n")[0] ?? "";
      const labelMatch = firstLine.match(/【([^】]+)】/);
      tipLabel = labelMatch && labelMatch[1] ? labelMatch[1] : t("chat.tipLabelFallback");
    } else {
      tipLabel = t("chat.tipLabelFallback");
    }
  }
  // Extract attached file code blocks (```ext title="filename" ... ```) so the
  // bubble shows a compact file chip instead of the full content.
  const files: string[] = [];
  const afterFiles = text.replace(/```(\w+)\s+title="([^"]+)"\n[\s\S]*?```\n?/g, (_match, _ext, name) => {
    files.push(name);
    return "";
  });
  const stripped = afterFiles.replace(TIP_BLOCK_RE, "").replace(/<!-- kb-context:start -->[\s\S]*?<!-- kb-context:end -->\n*/g, "");
  if (!known.size) {
    return { text: stripped.trim() || "", skills: [], tipLabel, files };
  }
  const skills: string[] = [];
  const cleaned = stripped.replace(/\/skill:([\w-]+)/g, (full, name: string) => {
    if (known.has(name)) {
      skills.push(name);
      return "";
    }
    return full;
  });
  return { text: cleaned.replace(/[ \t]{2,}/g, " ").replace(/\s+$/g, "").trim() || "", skills, tipLabel, files };
}
const persistedMessages = ref<{ id: string; role: string; content: string | null; metadata: Record<string, unknown> | null; createdAt: number }[]>([]);

async function loadMessages() {
  const sessionId = props.sessionId;
  const history = await api.listMessages(sessionId);
  // A slow response for the previous session must not overwrite the new one.
  if (props.sessionId !== sessionId) return;
  persistedMessages.value = history;
  // Restore kb_search metadata from persisted messages
  const restored: Record<string, KbCallState> = {};
  for (const m of persistedMessages.value) {
    if (m.role === "user") {
      const meta = getKbSearchMeta(m.metadata);
      if (meta) {
        restored[m.id] = {
          phase: meta.phase as KbCallState["phase"],
          query: meta.query,
          hits: meta.hits,
          durationMs: meta.durationMs,
        };
      }
    }
  }
  kbSearchByMessage.value = { ...kbSearchByMessage.value, ...restored };
  await nextTick();
  scrollToBottom();
}

onMounted(async () => {
  agent.subscribe(props.sessionId);
  await loadMessages();
  await kbBindingStore.load(props.sessionId);
  await kbStore.loadAll();
});

watch(() => props.sessionId, async (sessionId, previousSessionId) => {
  agent.unsubscribe(previousSessionId);
  agent.subscribe(sessionId);
  kbSearchByMessage.value = {};
  persistedMessages.value = [];
  await loadMessages();
  await kbBindingStore.load(props.sessionId);
});

onUnmounted(() => {
  stopDurationTimer();
  agent.unsubscribe(props.sessionId);
});

watch(
  () => messages.value.length,
  () => {
    if (followLiveOutput.value) nextTick(scrollToBottom);
    else newContentBelow.value = true;
  },
);

const liveTextSignature = computed(() => messages.value.map((message) =>
  message.parts
    .filter((part) => part.kind === "text")
    .map((part) => part.kind === "text" ? part.text.length : 0)
    .join(","),
).join("|"));

watch(
  liveTextSignature,
  () => {
    if (followLiveOutput.value) nextTick(scrollToBottom);
    else newContentBelow.value = true;
  },
);

function scrollToBottom() {
  if (messagesEl.value) {
    messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
  }
}

// ─── Scroll-to-bottom button ───────────────────────────────────────────
// ─── Conversation outline (user questions) ─────────────────────────────
const showOutline = ref(false);

interface OutlineItem {
  id: string;
  text: string;
  index: number;
  createdAt: number | null;
}

const userQuestions = computed<OutlineItem[]>(() => {
  let idx = 0;
  return allMessages.value
    .filter((m) => m.role === "user")
    .map((m) => {
      const textPart = m.parts.find((p) => p.kind === "text");
      let text = textPart ? textPart.text : "";
      // Strip skill tip wrappers
      const split = splitSkillsFromText(text);
      text = split.text.trim();
      // Truncate long questions
      if (text.length > 80) text = text.substring(0, 80) + "…";
      return { id: m.id, text: text || "—", index: ++idx, createdAt: m.createdAt ?? null };
    });
});

function scrollToMessage(msgId: string): boolean {
  const container = messagesEl.value;
  if (!container) return false;
  const el = container.querySelector(`[data-msg-id="${msgId}"]`);
  if (!el) return false;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  showOutline.value = false;
  return true;
}

async function revealNotificationMessage(messageId?: string) {
  await loadMessages();
  await nextTick();
  if (!messageId || !scrollToMessage(messageId)) scrollToBottom();
}

function closeOutlineOnOutsideClick(event: MouseEvent) {
  if (!showOutline.value) return;
  const target = event.target;
  if (target instanceof Element && target.closest(".outline-panel, .outline-entry")) return;
  showOutline.value = false;
}

// Copy-message button (ChatGPT-style): shows a check briefly after copying
const copiedMsgId = ref<string | null>(null);
let copiedTimer: ReturnType<typeof setTimeout> | null = null;

function messagePlainText(m: { role: string; parts: MessagePart[] }): string {
  const texts: string[] = [];
  for (const part of m.parts) {
    if (part.kind !== "text") continue;
    // For user messages, strip skill-tip / file-attachment wrappers so the
    // copied text matches what's visually rendered in the bubble.
    texts.push(m.role === "user" ? splitSkillsFromText(part.text).text : part.text);
  }
  return texts.join("\n").trim();
}

function retryUserMessage(messageId: string) {
  if (isBusy.value) return;
  agent.dismissPromptErrors(props.sessionId);
  agent.retryUserMessage(props.sessionId, messageId);
}

function editFailedMessage(m: { id: string; role: string; parts: MessagePart[] }) {
  if (isBusy.value) return;
  input.value = messagePlainText(m);
  attachedImages.value = m.parts
    .filter((part): part is Extract<MessagePart, { kind: "image" }> => part.kind === "image")
    .map((part) => ({
      name: part.name,
      mediaType: part.mediaType,
      data: part.data,
      size: Math.ceil(part.data.length * 0.75),
      previewUrl: `data:${part.mediaType};base64,${part.data}`,
    }));
  agent.dismissPromptErrors(props.sessionId);
  agent.removeLocalMessage(props.sessionId, m.id);
  nextTick(() => document.querySelector<HTMLTextAreaElement>(".composer-input textarea")?.focus());
}

async function copyMessage(m: { id: string; role: string; parts: MessagePart[] }) {
  const text = messagePlainText(m);
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback for non-secure contexts
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
  copiedMsgId.value = m.id;
  if (copiedTimer) clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => { copiedMsgId.value = null; }, 2000);
}

// Event delegation for code-block copy buttons rendered inside v-html.
// The button markup is produced by renderMarkdown (wrapCodeBlocks).
async function onMsgContentClick(e: MouseEvent) {
  const btn = (e.target as HTMLElement).closest?.(".code-copy-btn");
  if (!btn) return;
  const wrap = btn.closest(".code-block-wrap");
  const code = wrap?.querySelector("pre code")?.textContent ?? "";
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = code;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
  btn.classList.add("copied");
  setTimeout(() => btn.classList.remove("copied"), 2000);
}

function onMessagesScroll() {
  const el = messagesEl.value;
  if (!el) return;
  // Show when user has scrolled up more than 200px from the bottom
  const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
  showScrollButton.value = distanceFromBottom > 200;
  followLiveOutput.value = distanceFromBottom < 64;
  if (followLiveOutput.value) newContentBelow.value = false;
}

function handleClickScrollToBottom() {
  const el = messagesEl.value;
  if (!el) return;
  followLiveOutput.value = true;
  newContentBelow.value = false;
  el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
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

function toolArtifacts(result: unknown): ArtifactItem[] {
  const found: ArtifactItem[] = [];
  const seen = new Set<unknown>();
  const visit = (value: unknown, depth: number) => {
    if (depth > 5 || !value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    const record = value as Record<string, unknown>;
    if (
      typeof record.path === "string"
      && typeof record.name === "string"
      && typeof record.mimeType === "string"
      && (record.path.startsWith("browser/") || record.path.startsWith("computer/"))
    ) {
      found.push({
        path: record.path,
        name: record.name,
        mimeType: record.mimeType,
      });
    }
    for (const child of Object.values(record)) visit(child, depth + 1);
  };
  visit(result, 0);
  return found.filter((item, index) =>
    found.findIndex((candidate) => candidate.path === item.path) === index,
  );
}

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

function onSkillSelect(name: string) {
  if (!selectedSkills.value.includes(name)) {
    selectedSkills.value = [...selectedSkills.value, name];
  }
  nextTick(() => {
    const el = document.querySelector<HTMLTextAreaElement>(".composer-input textarea");
    el?.focus();
  });
}

function removeSkill(name: string) {
  selectedSkills.value = selectedSkills.value.filter((n) => n !== name);
}

const isComposing = ref(false);

function handleKeySend(e: KeyboardEvent) {
  if (e.isComposing || isComposing.value) return;
  if (e.key === "Enter" && !e.shiftKey) {
    if (isBusy.value) return;
    e.preventDefault();
    send();
  }
}

// Artifact validation cache (path → validation result)
const artifactValidation = ref<Record<string, ArtifactValidation>>({});

function isAvailableArtifact(item: ArtifactItem): boolean {
  return artifactValidation.value[item.path]?.exists === true;
}

function isMissingArtifact(item: ArtifactItem): boolean {
  const validation = artifactValidation.value[item.path];
  return validation !== undefined && !validation.exists;
}

const mergedMessageSources = computed(() => {
  const persisted = persistedMessages.value.map((m) => ({
    id: m.id,
    role: m.role as "user" | "assistant",
    parts: partsFromPersisted(m.content, m.metadata),
    streaming: false,
    persisted: true,
    createdAt: m.createdAt,
    clientMessageId: typeof m.metadata?.clientMessageId === "string"
      ? m.metadata.clientMessageId
      : undefined,
    metadata: m.metadata,
    failed: false,
    error: undefined as string | undefined,
  }));
  const live = messages.value.map((m) => ({
    id: m.id,
    role: m.role,
    parts: m.parts,
    streaming: m.status === "streaming",
    persisted: false,
    createdAt: m.createdAt,
    clientMessageId: m.role === "user" ? m.id : undefined,
    metadata: m.metadata,
    failed: m.status === "error",
    error: m.error,
  }));
  return mergeChatMessageSources(persisted, live);
});
const tokenUsage = computed(() => summarizeTokenUsage(mergedMessageSources.value));

const allMessages = computed(() => {
  const all = mergedMessageSources.value;
  const latest = all.at(-1);
  const messageSources = isBusy.value && (!latest || latest.role === "user")
    ? [
        ...all,
        {
          id: `pending-assistant:${latest?.id ?? props.sessionId}`,
          role: "assistant" as const,
          parts: [] as MessagePart[],
          streaming: true,
          persisted: false,
          createdAt: agent.runStartedAtFor(props.sessionId) ?? Date.now(),
          metadata: null,
          failed: false,
          error: undefined,
        },
      ]
    : all;
  const decorated = messageSources.map((m) => {
    // Extract <artifacts> blocks from assistant text parts
    let artifacts: ArtifactItem[] = [];
    let parts = m.parts;
    if (m.role === "assistant") {
      const newParts: MessagePart[] = [];
      for (const p of parts) {
        if (p.kind === "text") {
          const parsed = parseArtifacts(p.text);
          if (parsed.items.length) {
            artifacts.push(...parsed.items);
            if (parsed.text) newParts.push({ kind: "text", text: parsed.text });
          } else {
            newParts.push(p);
          }
        } else {
          newParts.push(p);
          if (p.kind === "tool_call" && p.result !== undefined) {
            artifacts.push(...toolArtifacts(p.result));
          }
        }
      }
      parts = newParts;
    }
    return {
      ...m,
      parts,
      artifacts,
      hasNonTextContent: m.role === "assistant"
        && (parts.some((part) => part.kind !== "text") || artifacts.length > 0),
      hasVisibleContent: m.role === "assistant"
        && (parts.some((part) => part.kind === "image" || (part.kind === "text" && part.text.trim().length > 0))
          || artifacts.length > 0),
      kbSearch: kbSearchByMessage.value[m.id] ?? null,
      // Build chunkMap from persisted metadata or live search state for citation rendering
      chunkMap: buildChunkMap(m.id, m.metadata),
    };
  });

  const annotated = annotateChatRuns(decorated, {
    isBusy: isBusy.value,
    activeElapsedMs: activeElapsedMs.value,
    expandedRunIds: expandedRunIds.value,
    outcome: agent.runOutcomeFor(props.sessionId),
    waitingForPermission: Boolean(pendingPermission.value),
  });

  return annotated;
});

// Validate artifact files exist on disk
watch(allMessages, async (msgs) => {
  const items = msgs.flatMap((m) => m.artifacts);
  if (!items.length) return;
  const toValidate = items.filter((i) => !(i.path in artifactValidation.value));
  if (!toValidate.length) return;
  try {
    const results = await api.validateArtifacts(props.projectId, toValidate);
    let hasNewFile = false;
    for (const r of results) {
      artifactValidation.value[r.path] = r;
      if (r.exists) hasNewFile = true;
    }
    if (hasNewFile) {
      agent.fileChangeSeq++;
      agent.lastFileChange = { sessionId: props.sessionId, toolName: "artifact-validation", at: Date.now() };
    }
  } catch {
    // Validation failure is non-fatal — cards still render with default state
  }
}, { deep: true });

function buildChunkMap(
  msgId: string,
  metadata: Record<string, unknown> | null,
): Record<number, { kbName: string; fileName: string; titlePath: string | null; pageStart: number | null; pageEnd: number | null }> {
  // From live kb_search state
  const liveSearch = kbSearchByMessage.value[msgId];
  if (liveSearch?.hits) {
    const map: Record<number, any> = {};
    for (const hit of liveSearch.hits) {
      map[hit.localId] = {
        kbName: hit.kbName,
        fileName: hit.fileName,
        titlePath: hit.titlePath,
        pageStart: hit.pageStart,
        pageEnd: hit.pageEnd,
      };
    }
    return map;
  }
  // From persisted metadata — the user message's metadata contains kbSearch,
  // but the *assistant* message's citations reference the same chunkMap.
  // The assistant doesn't have kbSearch in its metadata; we need to find the
  // preceding user message's kbSearch metadata to build the chunkMap.
  // For simplicity, we'll handle this at the template level.
  return {};
}

// Build a session-wide chunkMap from the most recent user message's kbSearch metadata.
// This allows assistant messages that reference [N] to resolve citations.
const sessionChunkMap = computed(() => {
  const map: Record<number, { kbName: string; fileName: string; titlePath: string | null; pageStart: number | null; pageEnd: number | null }> = {};
  // Check persisted messages for kbSearch metadata on user messages
  for (const m of persistedMessages.value) {
    if (m.role !== "user") continue;
    const meta = getKbSearchMeta(m.metadata);
    if (meta?.hits) {
      for (const hit of meta.hits) {
        map[hit.localId] = {
          kbName: hit.kbName,
          fileName: hit.fileName,
          titlePath: hit.titlePath,
          pageStart: hit.pageStart,
          pageEnd: hit.pageEnd,
        };
      }
    }
  }
  // Check live kb_search states
  for (const state of Object.values(kbSearchByMessage.value)) {
    if (state.hits) {
      for (const hit of state.hits) {
        map[hit.localId] = {
          kbName: hit.kbName,
          fileName: hit.fileName,
          titlePath: hit.titlePath,
          pageStart: hit.pageStart,
          pageEnd: hit.pageEnd,
        };
      }
    }
  }
  return map;
});

const messageLevelErrorCodes = new Set([
  "pi_prompt_failed",
  "pi_prompt_write_failed",
  "pi_model_error",
  "project_workdir_missing",
]);
const sessionErrors = computed(() => {
  const hasFailedUserMessage = messages.value.some((message) => message.role === "user" && message.status === "error");
  return agent.errors.filter((error) =>
    error.sessionId === props.sessionId
      && !(hasFailedUserMessage && messageLevelErrorCodes.has(error.code)),
  );
});
const permissionMessage = computed(() => {
  const pending = pendingPermission.value;
  if (!pending) return "";
  const intent = pending.intent
    ? `\n${t("plugins.permissionIntent", { intent: pending.intent })}`
    : "";
  const url = pending.context?.url
    ? `\n${t("plugins.permissionUrl", { url: pending.context.url })}`
    : "";
  const target = pending.context?.target
    ? `\n${t("plugins.permissionTarget", { target: pending.context.target })}`
    : "";
  const windowId = pending.context?.windowId
    ? `\n${t("plugins.permissionWindow", { windowId: pending.context.windowId })}`
    : "";
  const files = pending.context?.files?.length
    ? `\n${t("plugins.permissionFiles", { files: pending.context.files.join(", ") })}`
    : "";
  return `${pending.reason}\n${t("plugins.permissionAction", {
    plugin: pending.pluginId,
    action: pending.action,
  })}${intent}${url}${target}${windowId}${files}`;
});

function respondToPermission(approved: boolean) {
  const pending = pendingPermission.value;
  if (!pending) return;
  agent.respondToPermission(props.sessionId, pending.requestId, approved);
}

// Label of the tip that will be auto-injected on send when one of the selected
// skills has an entry in SKILL_TIPS. Drives the inline composer banner so the
// user knows the reminder will be attached before they hit send.
const pendingTipLabel = computed(() => {
  const key = activeTipLabel(selectedSkills.value);
  return key ? t(key) : null;
});

defineExpose({ revealNotificationMessage });
</script>

<template>
  <div class="chat-panel" @click="closeOutlineOnOutsideClick">
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

    <!-- Messages wrapper (scroll + button) -->
    <div class="messages-wrap">
      <div
        v-if="userQuestions.length"
        class="outline-entry"
      >
        <button
          class="outline-toggle-btn"
          :class="{ active: showOutline }"
          :title="t('chat.outline')"
          :aria-label="t('chat.outline')"
          :aria-expanded="showOutline"
          aria-controls="conversation-outline-panel"
          @click.stop="showOutline = !showOutline"
        >
          <span class="outline-handle" aria-hidden="true" />
          <span class="outline-toggle-content">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.4" />
              <path d="M8 5v3l2 1.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            <span class="outline-toggle-label">{{ t('chat.outline') }}</span>
          </span>
        </button>
      </div>

      <Transition name="outline-slide">
        <aside v-if="showOutline" id="conversation-outline-panel" class="outline-panel">
          <div class="outline-header">
            <span class="outline-title">{{ t('chat.outline') }}</span>
            <button class="outline-close" @click="showOutline = false">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
              </svg>
            </button>
          </div>
          <div class="outline-timeline">
            <div
              v-for="q in userQuestions"
              :key="q.id"
              class="timeline-node"
              @click="scrollToMessage(q.id)"
            >
              <div class="timeline-dot" />
              <div class="timeline-content">
                <div class="timeline-time" v-if="q.createdAt">
                  {{ formatTime(q.createdAt) }}
                </div>
                <div class="timeline-text">{{ q.text }}</div>
              </div>
            </div>
          </div>
        </aside>
      </Transition>

    <div class="messages" ref="messagesEl" @scroll="onMessagesScroll">
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

      <template v-for="m in allMessages" :key="m.id">
      <div
        v-if="!m.hidden"
        class="msg"
        :data-msg-id="m.id"
        :class="[m.role, {
          streaming: m.streaming,
          continued: !m.showHeader && !m.statusOnly,
          'run-status-only': m.statusOnly,
        }]"
      >
        <div v-if="m.role === 'user'" class="msg-avatar-row">
          <span class="msg-avatar-label">user</span>
          <div class="msg-avatar" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="4.8" r="2.4" fill="currentColor" />
              <path d="M2.3 12c0-2.6 2.1-4.6 4.7-4.6s4.7 2 4.7 4.6z" fill="currentColor" />
            </svg>
          </div>
        </div>
        <AgentActivity
          v-if="m.showActivity && m.activity"
          :activity="m.activity"
          :expanded="m.runExpanded"
          :can-toggle="m.canToggleRun"
          @toggle="toggleRun(m.runId, m.canToggleRun)"
        />
        <button
          v-if="!m.showActivity && m.showRunStatus && m.displayDurationMs !== null"
          type="button"
          class="assistant-duration"
          :class="{ expanded: m.runExpanded, toggleable: m.canToggleRun }"
          :aria-expanded="m.canToggleRun ? m.runExpanded : undefined"
          :aria-disabled="!m.canToggleRun"
          :title="m.canToggleRun
            ? (m.runExpanded
              ? t('chat.collapseRunHistory')
              : t('chat.expandRunHistory'))
            : undefined"
          @click="toggleRun(m.runId, m.canToggleRun)"
        >
          <span>{{ t('chat.processedDuration', { duration: formatProcessingDuration(m.displayDurationMs) }) }}</span>
          <svg v-if="m.canToggleRun" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M4.5 2.5 8 6 4.5 9.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
        <div v-if="!m.statusOnly" class="msg-body">
          <template v-for="(p, pi) in m.parts" :key="pi">
            <!-- Image part — show thumbnail in message bubble -->
            <div v-if="p.kind === 'image' && !m.hideNonTextContent" class="msg-image-wrap">
              <img
                :src="`data:${p.mediaType};base64,${p.data}`"
                :alt="p.name"
                class="msg-image"
                @click="openImagePreview(p)"
              />
            </div>
            <template v-else-if="p.kind === 'text' && m.role === 'user'">
              <template v-for="split in [splitSkillsFromText(p.text)]" :key="0">
                <div v-if="split.tipLabel" class="msg-tip-badge">
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                    <circle cx="6" cy="6" r="5" stroke="currentColor" stroke-width="1.2" />
                    <path d="M6 5v3M6 3.5v.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
                  </svg>
                  <span>{{ split.tipLabel }}</span>
                </div>
                <div v-if="split.skills.length" class="msg-skill-chips">
                  <span v-for="name in split.skills" :key="name" class="skill-chip static">
                    <svg class="chip-icon" width="11" height="11" viewBox="0 0 12 12" fill="none">
                      <path d="M6 1.2l4.2 2.4v4.8L6 10.8 1.8 8.4V3.6z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round" />
                      <circle cx="6" cy="6" r="1.4" fill="currentColor" />
                    </svg>
                    <span class="chip-name">{{ name }}</span>
                  </span>
                </div>
                <div v-if="split.files.length" class="msg-file-chips">
                  <span v-for="fname in split.files" :key="fname" class="file-chip static">
                    <svg class="chip-icon" width="11" height="11" viewBox="0 0 12 12" fill="none">
                      <path d="M3 1.5h4L9 3.5v7a1 1 0 01-1 1H3a1 1 0 01-1-1v-8a1 1 0 011-1z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round" />
                      <path d="M7 1.5v2h2" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round" />
                    </svg>
                    <span class="chip-name">{{ fname }}</span>
                  </span>
                </div>
                <div v-if="split.text" class="msg-content" @click="onMsgContentClick" v-html="renderMarkdown(split.text)"></div>
              </template>
            </template>
            <div v-else-if="p.kind === 'text' && !m.hideActivityText" class="msg-content" @click="onMsgContentClick" v-html="renderKbCitations(renderMarkdown(p.text), sessionChunkMap)"></div>
          </template>
          <!-- Artifact cards (files delivered by the agent) -->
          <template v-if="m.artifacts?.length && !m.hideNonTextContent">
            <div v-if="m.artifacts.some(isAvailableArtifact)" class="artifact-cards">
              <ArtifactCard
                v-for="a in m.artifacts.filter(isAvailableArtifact)"
                :key="a.path"
                :project-id="projectId"
                :artifact="a"
                :exists="true"
                :size="artifactValidation[a.path]?.size ?? null"
                @preview="(p) => emit('select-file', p)"
              />
            </div>
            <div v-if="m.artifacts.some(isMissingArtifact)" class="artifact-invalid-list" role="status">
              <div v-for="a in m.artifacts.filter(isMissingArtifact)" :key="a.path" class="artifact-invalid">
                <span class="artifact-invalid-name">{{ a.name }}</span>
                <span>{{ t('artifact.invalidDeclaration') }}</span>
              </div>
            </div>
          </template>
        </div>
        <!-- KB search call card (shown under user messages) -->
        <ChatKbCallCard v-if="m.role === 'user' && m.kbSearch" :state="m.kbSearch" />
        <div
          v-if="!m.statusOnly && m.showMessageActions && !m.streaming"
          class="msg-actions"
          :class="m.role"
        >
          <button
            v-if="!m.streaming && messagePlainText(m)"
            type="button"
            class="msg-copy-btn"
            :class="{ copied: copiedMsgId === m.id }"
            :title="copiedMsgId === m.id ? t('chat.copied') : t('chat.copy')"
            :aria-label="copiedMsgId === m.id ? t('chat.copied') : t('chat.copy')"
            @click="copyMessage(m)"
          >
            <svg v-if="copiedMsgId === m.id" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M2.5 7.5 5.5 10.5 11.5 3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            <svg v-else width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <rect x="4.5" y="4.5" width="8" height="8" rx="2" stroke="currentColor" stroke-width="1.3" />
              <path d="M9.5 4.5v-1a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h1" stroke="currentColor" stroke-width="1.3" />
            </svg>
          </button>
          <div
            v-if="m.createdAt && !m.streaming"
            class="msg-time"
            :title="formatTimeFull(m.createdAt)"
          >{{ formatTime(m.createdAt) }}</div>
        </div>
        <div v-if="m.role === 'user' && m.failed" class="message-failure" role="alert">
          <span>{{ m.error && m.error !== 'connection_unavailable' ? m.error : t('chat.messageFailed') }}</span>
          <button type="button" @click="retryUserMessage(m.id)">{{ t('chat.retry') }}</button>
          <button type="button" @click="editFailedMessage(m)">{{ t('chat.editAndResend') }}</button>
        </div>
      </div>
      </template>
    </div>

      <Transition name="scroll-btn-fade">
        <button
          v-if="showScrollButton"
          class="scroll-to-bottom-btn"
          :class="{ 'has-new-content': newContentBelow }"
          :title="t('chat.scrollToBottom')"
          :aria-label="newContentBelow ? t('chat.newReply') : t('chat.scrollToBottom')"
          @click="handleClickScrollToBottom"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M8 3v10M4 9l4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <span v-if="newContentBelow">{{ t('chat.newReply') }}</span>
        </button>
      </Transition>
    </div>

    <!-- Composer -->
    <div class="composer">
      <ChatKbBanner :session-id="sessionId" />
      <div v-if="pendingTipLabel" class="tip-banner">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <circle cx="6" cy="6" r="5" stroke="currentColor" stroke-width="1.2" />
          <path d="M6 5v3M6 3.5v.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
        </svg>
        <span class="tip-banner-label">{{ pendingTipLabel }}</span>
        <span class="tip-banner-hint">{{ t('chat.tipAutoAttached') }}</span>
      </div>
      <div v-if="selectedSkills.length" class="skill-chips">
        <span v-for="name in selectedSkills" :key="name" class="skill-chip">
          <svg class="chip-icon" width="11" height="11" viewBox="0 0 12 12" fill="none">
            <path d="M6 1.2l4.2 2.4v4.8L6 10.8 1.8 8.4V3.6z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round" />
            <circle cx="6" cy="6" r="1.4" fill="currentColor" />
          </svg>
          <span class="chip-name">{{ name }}</span>
          <button class="chip-remove" :title="t('skill.uninstall')" @click="removeSkill(name)">
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
              <path d="M2 2l5 5M7 2l-5 5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
            </svg>
          </button>
        </span>
      </div>
      <div v-if="attachedFiles.length" class="file-chips">
        <span v-for="(f, i) in attachedFiles" :key="f.name + i" class="file-chip">
          <svg class="chip-icon" width="11" height="11" viewBox="0 0 12 12" fill="none">
            <path d="M3 1.5h4L9 3.5v7a1 1 0 01-1 1H3a1 1 0 01-1-1v-8a1 1 0 011-1z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round" />
            <path d="M7 1.5v2h2" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round" />
          </svg>
          <span class="chip-name">{{ f.name }}</span>
          <span class="chip-meta">{{ formatFileSize(f.size) }}</span>
          <button class="chip-remove" :title="t('kb.file.delete')" @click="removeAttachedFile(i)">
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
              <path d="M2 2l5 5M7 2l-5 5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
            </svg>
          </button>
        </span>
      </div>
      <div v-if="attachedImages.length" class="image-previews">
        <span v-for="(img, i) in attachedImages" :key="img.name + i" class="image-preview-chip">
          <img :src="img.previewUrl" :alt="img.name" class="image-preview-thumb" />
          <button class="chip-remove" :title="t('kb.file.delete')" @click="removeAttachedImage(i)">
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
              <path d="M2 2l5 5M7 2l-5 5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
            </svg>
          </button>
        </span>
      </div>
      <input
        ref="fileInputEl"
        type="file"
        multiple
        class="file-input-hidden"
        :accept="ALL_EXTS_ACCEPT"
        @change="onFilePicked"
      />
      <!-- Toolbar: upload + skill + expert + KB -->
      <div class="composer-toolbar">
        <button class="tool-btn" :title="t('chat.upload')" @click="triggerFilePick">
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
            <path d="M7 9.5V2M4 4.5L7 1.5l3 3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
            <path d="M2 9v2.5a1 1 0 001 1h8a1 1 0 001-1V9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
          </svg>
          <span class="tool-btn-label">{{ t('chat.upload') }}</span>
        </button>
        <SkillSelect
          @select="onSkillSelect"
          @import="showImportSkill = true"
        />
        <ChatExpertPicker :session-id="sessionId" />
        <ChatKbPicker :session-id="sessionId" />
        <PluginSelect :session-id="sessionId" :disabled="isBusy" />
        <ConnectorSelect :project-id="projectId" :disabled="isBusy" @manage="emit('manage-connectors')" />
        <span
          v-if="compaction"
          class="compaction-status"
          :class="compaction.phase"
          :title="compaction.error || t('chat.compactionHint')"
        >
          <span v-if="compaction.phase === 'started'" class="compaction-spinner"></span>
          <span v-else class="compaction-icon">↻</span>
          {{ compactionLabel }}
        </span>
        <TokenUsage :key="sessionId" :usage="tokenUsage" :busy="isBusy" @compact="agent.compact(sessionId)" />
      </div>
      <!-- Input with embedded send button -->
      <div class="composer-input-wrap">
        <NInput
          v-model:value="input"
          type="textarea"
          :rows="3"
          :autosize="{ minRows: 3, maxRows: 5 }"
          :placeholder="t('chat.placeholder')"
          @keydown="handleKeySend"
          @compositionstart="isComposing = true"
          @compositionend="isComposing = false"
          @paste="handlePaste"
          class="composer-input"
        />
        <div class="composer-actions">
          <NSelect
            v-if="agent.models.length"
            :value="agent.currentModel"
            :options="modelSelectOptions"
            size="small"
            :placeholder="t('model.selectForChat')"
            class="composer-model-select"
            @update:value="agent.switchModel($event, sessionId)"
          />
          <button
            v-if="isBusy"
            class="send-btn stop embedded"
            @click="agent.interrupt(props.sessionId)"
            :title="t('chat.stop')"
            :aria-label="t('chat.stop')"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <rect x="2" y="2" width="10" height="10" rx="1.5" fill="currentColor" />
            </svg>
          </button>
          <button
            v-else
            class="send-btn embedded"
            :disabled="!input.trim() && !selectedSkills.length && !attachedFiles.length && !attachedImages.length"
            @click="send"
            :title="t('chat.send')"
            :aria-label="t('chat.send')"
          >
            <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
              <path
                d="M2 9l14-7-7 14V9H2z"
                fill="currentColor"
              />
            </svg>
            <span class="send-label">{{ t('chat.send') }}</span>
          </button>
        </div>
      </div>
      <div v-if="isBusy" class="composer-busy-hint">{{ t('chat.busyDraftHint') }}</div>
    </div>
    <ImportSkillDialog
      data-test="import-skill-dialog"
      :show="showImportSkill"
      @close="showImportSkill = false"
    />
    <ConfirmDialog
      data-test="plugin-permission-dialog"
      :show="Boolean(pendingPermission)"
      :title="t('plugins.permissionTitle')"
      :message="permissionMessage"
      :confirm-label="t('plugins.permissionApprove')"
      :cancel-label="t('plugins.permissionDeny')"
      danger
      @confirm="respondToPermission(true)"
      @close="respondToPermission(false)"
    />
    <Teleport to="body">
      <div v-if="previewImage" class="image-lightbox" @click="closeImagePreview">
        <img :src="`data:${previewImage.mediaType};base64,${previewImage.data}`" :alt="previewImage.name" class="lightbox-img" />
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.chat-panel {
  --chat-content-gutter: clamp(96px, 15vw, 280px);
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

.messages-wrap {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.messages {
  flex: 1;
  overflow-y: auto;
  padding: 24px var(--chat-content-gutter) 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* ─── Scroll-to-bottom Button ─── */

.scroll-to-bottom-btn {
  position: absolute;
  right: 24px;
  bottom: 16px;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-default);
  border-radius: 50%;
  background: var(--bg-elevated);
  color: var(--text-secondary);
  cursor: pointer;
  box-shadow: var(--shadow-md);
  transition: all var(--transition-fast);
  z-index: 10;
}

.scroll-to-bottom-btn.has-new-content {
  width: auto;
  padding: 0 12px;
  gap: 6px;
  border-radius: 18px;
  color: var(--accent);
  font-size: 11px;
  font-weight: 600;
}

.scroll-to-bottom-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
  box-shadow: var(--shadow-lg);
}

.scroll-btn-fade-enter-active,
.scroll-btn-fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.scroll-btn-fade-enter-from,
.scroll-btn-fade-leave-to {
  opacity: 0;
  transform: translateY(8px);
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

/* User ─ right-aligned column: fixed avatar above, pale-blue bubble below, time under that */
.msg.user {
  align-self: flex-end;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
  padding: 0;
  border: none;
  background: transparent;
  box-shadow: none;
  animation: msgInRight 0.3s var(--ease-out) both;
  /* reserve space for the absolutely-positioned timestamp floating below the bubble */
  margin-bottom: 10px;
}

/* Fixed user avatar — a soft blue disc with a person glyph, floating above the bubble */
.msg-avatar {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  background: linear-gradient(135deg, #7ba4e8 0%, #4d7fc9 100%);
  box-shadow: 0 2px 8px rgba(77, 127, 201, 0.35);
}

/* The bubble itself — very pale blue, snubbed bottom-right tail */
.msg.user .msg-body {
  position: relative;
  background: var(--chat-user-bg);
  border: 1px solid var(--chat-user-border);
  border-radius: var(--radius-lg);
  border-bottom-right-radius: 2px;
  padding: 10px 14px;
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.18);
}

/* a small blue corner mark accenting the tail */
.msg.user .msg-body::after {
  content: "";
  position: absolute;
  right: 8px;
  bottom: 5px;
  width: 5px;
  height: 5px;
  border-right: 1px solid rgba(86, 132, 213, 0.6);
  border-bottom: 1px solid rgba(86, 132, 213, 0.6);
  border-bottom-right-radius: 1px;
  opacity: 0.6;
}

/* Assistant replies are document-style content, not chat bubbles. */
.msg.assistant {
  align-self: flex-start;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  width: min(880px, 100%);
  max-width: 100%;
  padding: 4px 0 8px;
  border: none;
  background: transparent;
  box-shadow: none;
  border-radius: 0;
  animation: msgInLeft 0.3s var(--ease-out) both;
  margin-bottom: 6px;
}

.msg.assistant::before {
  display: none;
}

.msg.assistant.continued {
  margin-top: -4px;
}

.msg.assistant.run-status-only {
  margin-bottom: -8px;
  padding-bottom: 0;
  animation: none;
}

.msg.assistant.run-status-only::before {
  display: none;
}

/* chain consecutive assistant rails into a continuous line */
.msg.assistant.continued::before {
  top: 0;
  bottom: 10px;
  opacity: 0.5;
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

.msg-avatar-row {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 22px;
}

/* User row mirrors the agent row but flips order so the disc sits at the bubble's right edge */
.msg.user .msg-avatar-row {
  flex-direction: row-reverse;
}

.msg-avatar-label {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: var(--text-secondary);
  white-space: nowrap;
}

/* Fixed agent avatar — a native 22px panda SVG, floating above the body */
.msg-avatar.assistant {
  background: #ddf7e7;
  box-shadow: 0 2px 8px rgba(105, 180, 130, 0.3);
}

.msg-avatar.assistant img {
  display: block;
  width: 100%;
  height: 100%;
}

/* ─── Message actions row (copy button + timestamp, role-aligned) ─── */

.msg-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 5px;
}

.msg-time {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.04em;
  line-height: 1.2;
  white-space: nowrap;
  opacity: 0.7;
  color: var(--text-secondary);
}

.message-failure {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
  max-width: 520px;
  color: var(--rose);
  font-size: 11px;
}

.message-failure button {
  padding: 2px 7px;
  border: 1px solid color-mix(in srgb, var(--rose) 45%, var(--border-default));
  border-radius: var(--radius-sm);
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
}

.message-failure button:hover {
  background: var(--rose-dim);
}

/* User actions float below the bubble, right-aligned to its right edge —
   the bubble shrinks to body width instead of expanding to fit the row. */
.msg.user .msg-actions {
  position: absolute;
  top: 100%;
  right: 0;
  flex-direction: row-reverse;
  margin-top: 7px;
}

.msg.assistant .msg-actions {
  text-align: left;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--transition-fast);
}

.msg.assistant:hover .msg-actions,
.msg.assistant:focus-within .msg-actions {
  opacity: 1;
  pointer-events: auto;
}

/* Match Codex's live-answer rhythm: keep transient metadata out of the way
   while content is arriving and use one quiet caret as the only text-level
   progress affordance. The run header remains the primary status indicator. */
.msg.assistant.streaming .msg-content:last-of-type :deep(p:last-child)::after,
.msg.assistant.streaming .msg-content:last-of-type :deep(li:last-child)::after,
.msg.assistant.streaming .msg-content:last-of-type :deep(h1:last-child)::after,
.msg.assistant.streaming .msg-content:last-of-type :deep(h2:last-child)::after,
.msg.assistant.streaming .msg-content:last-of-type :deep(h3:last-child)::after {
  content: "";
  display: inline-block;
  width: 5px;
  height: 13px;
  margin-left: 3px;
  border-radius: 1px;
  background: var(--text-muted);
  vertical-align: -2px;
  animation: streamingCaret 1s steps(2, jump-none) infinite;
}

@keyframes streamingCaret {
  50% { opacity: 0.2; }
}

@media (prefers-reduced-motion: reduce) {
  .msg.assistant.streaming .msg-content:last-of-type :deep(p:last-child)::after,
  .msg.assistant.streaming .msg-content:last-of-type :deep(li:last-child)::after,
  .msg.assistant.streaming .msg-content:last-of-type :deep(h1:last-child)::after,
  .msg.assistant.streaming .msg-content:last-of-type :deep(h2:last-child)::after,
  .msg.assistant.streaming .msg-content:last-of-type :deep(h3:last-child)::after {
    animation: none;
  }
}

@media (hover: none) {
  .msg.assistant .msg-actions {
    opacity: 1;
    pointer-events: auto;
  }
}

/* Copy button: always visible in the message actions row */
.msg-copy-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-faint, var(--text-secondary));
  cursor: pointer;
  opacity: 1;
  transition: opacity var(--transition-fast), color var(--transition-fast), background var(--transition-fast);
}

.msg-copy-btn:focus-visible,
.msg-copy-btn.copied {
  opacity: 1;
}

.msg-copy-btn:hover {
  color: var(--text-secondary);
  background: var(--bg-hover, rgba(128, 128, 128, 0.12));
}

.msg-copy-btn.copied {
  color: var(--accent);
}

.assistant-duration {
  display: flex;
  align-items: center;
  gap: 3px;
  justify-content: flex-start;
  width: min(720px, 68vw);
  max-width: 100%;
  margin: 0 0 2px;
  padding: 0 0 9px;
  border: 0;
  border-bottom: 1px solid var(--border-default);
  border-radius: 0;
  background: transparent;
  color: var(--text-muted);
  font-family: inherit;
  font-size: 12px;
  line-height: 18px;
  text-align: left;
  cursor: default;
  opacity: 1;
}

.assistant-duration svg {
  flex: none;
  color: var(--text-faint);
  transition: transform var(--transition-fast), color var(--transition-fast);
}

.assistant-duration.toggleable {
  cursor: pointer;
}

.assistant-duration.toggleable:hover {
  color: var(--text-secondary);
  border-bottom-color: var(--border-active);
}

.assistant-duration.toggleable:hover svg {
  color: var(--text-secondary);
}

.assistant-duration.expanded svg {
  transform: rotate(90deg);
}

/* ─── Artifact Cards ─── */

.artifact-cards {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
  max-width: 420px;
}

.artifact-invalid-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 10px;
  max-width: 420px;
}

.artifact-invalid {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 6px 10px;
  border: 1px dashed color-mix(in srgb, var(--danger-color) 45%, var(--border-default));
  border-radius: var(--radius-md, 8px);
  color: var(--danger-color);
  font-size: 11px;
}

.artifact-invalid-name {
  overflow: hidden;
  color: var(--text-secondary);
  font-family: var(--font-mono);
  text-overflow: ellipsis;
  white-space: nowrap;
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
  color: var(--chat-user-text);
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

/* Code-block copy button — injected by renderMarkdown (wrapCodeBlocks) */
.msg-content :deep(.code-block-wrap) {
  position: relative;
}
.msg-content :deep(.code-block-wrap pre) {
  /* keep original pre styles; already applied to nested pre via selector above */
}
.msg-content :deep(.code-copy-btn) {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-faint, var(--text-secondary));
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--transition-fast), color var(--transition-fast), background var(--transition-fast);
}
.msg-content :deep(.code-block-wrap:hover .code-copy-btn),
.msg-content :deep(.code-copy-btn:focus-visible),
.msg-content :deep(.code-copy-btn.copied) {
  opacity: 1;
}
.msg-content :deep(.code-copy-btn:hover) {
  color: var(--text-secondary);
  background: var(--bg-hover, rgba(128, 128, 128, 0.12));
}
.msg-content :deep(.code-copy-btn.copied) {
  color: var(--accent);
}

.msg-content :deep(.markdown-table-wrap) {
  max-width: 100%;
  margin: 0.4em 0 0.85em;
  overflow-x: auto;
  border-radius: var(--radius-sm);
}

.msg-content :deep(table) {
  border-collapse: collapse;
  width: max-content;
  min-width: 100%;
  margin: 0;
  font-size: 12.5px;
  display: table;
}
.msg-content :deep(thead) {
  display: table-header-group;
}
.msg-content :deep(tbody) {
  display: table-row-group;
}
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

/* Assistant messages use a left-aligned flex column, so the body must not
   fall back to its content's max-content width. Keep wide markdown inside the
   message and let its own wrappers provide horizontal scrolling. */
.msg.assistant .msg-body {
  width: 100%;
  min-width: 0;
}

.compaction-status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-left: auto;
  color: var(--text-muted);
  font-size: 10px;
  white-space: nowrap;
}

.compaction-status + .token-usage {
  margin-left: 0;
}

.compaction-status.failed {
  color: var(--error-color, #d45b5b);
}

.compaction-icon {
  color: var(--accent);
  font-size: 12px;
}

.compaction-spinner {
  width: 9px;
  height: 9px;
  border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: compaction-spin 0.8s linear infinite;
}

@keyframes compaction-spin {
  to { transform: rotate(360deg); }
}

/* ─── Composer ─── */

.composer {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px var(--chat-content-gutter) 16px;
  background: var(--bg-surface);
  flex-shrink: 0;
}

.composer-busy-hint {
  margin-top: -4px;
  color: var(--text-muted);
  font-size: 10px;
  line-height: 1.4;
}

.composer-toolbar {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 2px 0;
}

.composer-toolbar > * {
  flex-shrink: 0;
}


.tool-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: auto;
  min-width: 72px;
  height: 28px;
  gap: 5px;
  padding: 0 10px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
  flex-shrink: 0;
}
.tool-btn-label {
  font-size: 12px;
  white-space: nowrap;
}
.tool-btn:hover {
  color: var(--text-primary);
}

.browser-capability {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 8px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.browser-capability:hover:not(:disabled) {
  color: var(--text-primary);
  background: var(--bg-hover);
}

.browser-capability.enabled {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border-default));
  background: var(--accent-dim);
  color: var(--accent);
}

.browser-capability.error {
  border-color: color-mix(in srgb, var(--rose) 45%, var(--border-default));
  background: var(--rose-dim);
  color: var(--rose);
}

.browser-capability:disabled {
  cursor: not-allowed;
  opacity: 0.65;
}

.browser-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.45;
}

.browser-capability.running .browser-dot {
  opacity: 1;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent);
}

.browser-spinner {
  width: 10px;
  height: 10px;
  border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
  border-top-color: currentColor;
  border-radius: 50%;
  animation: compaction-spin 0.8s linear infinite;
}

.file-input-hidden {
  display: none;
}

.composer-input-wrap {
  position: relative;
  display: flex;
  align-items: flex-end;
}

.composer-input {
  flex: 1;
}
.composer-input :deep(.n-input) {
  background: var(--bg-surface);
  /* reserve space on the right so embedded actions don't cover text */
  padding-right: 240px;
}
.composer-input :deep(.n-input__textarea-el) {
  background: transparent;
  padding-right: 8px;
}

/* Actions container — model select + send button at bottom-right of the input */
.composer-actions {
  position: absolute;
  right: 6px;
  bottom: 6px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.composer-model-select {
  width: 150px;
}
.composer-model-select :deep(.n-base-selection) {
  background: var(--bg-surface);
  font-size: 12px;
}
.composer-model-select :deep(.n-base-selection .n-base-selection-label) {
  background: var(--bg-surface);
}
.composer-model-select :deep(.n-base-selection-input) {
  background: transparent;
}

/* Embedded send button */
.send-btn.embedded {
  width: auto;
  height: 30px;
  padding: 0 14px;
  gap: 5px;
  border-radius: 15px;
  font-size: 13px;
  font-weight: 500;
  z-index: 1;
}
.send-label {
  line-height: 1;
  white-space: nowrap;
}

/* ─── Skill Chips ─── */

.skill-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 2px 0;
}

/* ─── Attached File Chips ─── */

.file-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 2px 0;
}

.file-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 4px 3px 8px;
  border-radius: 999px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-active);
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.02em;
  line-height: 1.2;
  white-space: nowrap;
}

.chip-meta {
  color: var(--text-muted);
  font-size: 10px;
}

.skill-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 4px 3px 8px;
  border-radius: 999px;
  background: var(--amber-dim);
  border: 1px solid rgba(229, 168, 18, 0.35);
  color: var(--amber);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  line-height: 1.2;
  white-space: nowrap;
}

.skill-chip.static {
  padding-right: 10px;
}

.chip-icon {
  flex-shrink: 0;
  opacity: 0.85;
}

.chip-name {
  display: inline-block;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chip-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  cursor: pointer;
  opacity: 0.55;
  transition: all var(--transition-fast);
  flex-shrink: 0;
}
.chip-remove:hover {
  opacity: 1;
  background: rgba(229, 168, 18, 0.2);
}

/* Chip row above a user message bubble */
.msg-skill-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}

.msg-file-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}

.file-chip.static {
  padding-right: 10px;
}

/* Badge shown in the user bubble when an auto-injected tip was attached to
   that message. Lets the user see *that* the rule was included without
   having to wade through the full injected code block. */
.msg-tip-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  margin-bottom: 8px;
  border-radius: 999px;
  background: var(--accent-dim);
  border: 1px solid var(--accent);
  color: var(--accent);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.03em;
}

/* Inline banner above the composer — visible while the user is still typing,
   so they know a tip will be attached to the next send. */
.tip-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  background: var(--accent-dim);
  border: 1px dashed var(--accent);
  color: var(--accent);
  font-size: 11px;
}
.tip-banner-label {
  font-family: var(--font-mono);
  font-weight: 600;
}
.tip-banner-hint {
  color: var(--text-muted);
  font-size: 10px;
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

/* Stop state — replaces the send button while the agent is streaming. */
.send-btn.stop {
  background: var(--rose);
  color: #fff;
}
.send-btn.stop:hover {
  background: var(--rose-hover, #e11d48);
  box-shadow: 0 0 0 4px rgba(244, 63, 94, 0.18);
  transform: translateY(-1px);
}
.send-btn.stop:active {
  transform: translateY(0);
}

/* ─── KB Citation Chips ─── */

.msg-content :deep(.kb-citation-chip) {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 6px;
  margin: 0 2px;
  border-radius: 999px;
  background: var(--accent-dim);
  border: 1px solid rgba(0, 184, 148, 0.3);
  color: var(--accent);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  cursor: default;
  white-space: nowrap;
  vertical-align: baseline;
  line-height: 1.4;
  transition: all var(--transition-fast);
}
.msg-content :deep(.kb-citation-chip:hover) {
  background: var(--accent);
  color: var(--bg-void);
  border-color: var(--accent);
}

/* ─── Image Previews in Composer ─── */

.image-previews {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 4px 0;
}

.image-preview-chip {
  position: relative;
  display: inline-block;
  border-radius: var(--radius-md);
  overflow: hidden;
  border: 1px solid var(--border-active);
  background: var(--bg-elevated);
}

.image-preview-thumb {
  display: block;
  width: 64px;
  height: 64px;
  object-fit: cover;
}

.image-preview-chip .chip-remove {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  border: none;
  border-radius: 50%;
  cursor: pointer;
  padding: 0;
}

/* ─── Images in Message Bubbles ─── */

.msg-image-wrap {
  margin-bottom: 8px;
}

.msg-image {
  max-width: 240px;
  max-height: 240px;
  border-radius: var(--radius-md);
  cursor: pointer;
  object-fit: contain;
  border: 1px solid var(--border-default);
  transition: opacity var(--transition-fast);
}

.msg-image:hover {
  opacity: 0.85;
}

/* ─── Image Lightbox ─── */

.image-lightbox {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.8);
  cursor: pointer;
}

.lightbox-img {
  max-width: 90vw;
  max-height: 90vh;
  object-fit: contain;
  border-radius: var(--radius-md);
}
/* ─── Conversation Outline (Timeline) ─── */

.outline-toggle-btn {
  width: 28px;
  height: 96px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0;
  border: 1px solid color-mix(in srgb, var(--primary-color) 28%, var(--border-default));
  border-right: none;
  border-radius: 10px 0 0 10px;
  background: color-mix(in srgb, var(--bg-surface) 90%, transparent);
  color: var(--text-secondary);
  cursor: pointer;
  position: relative;
  box-shadow: -4px 0 18px color-mix(in srgb, var(--primary-color) 8%, transparent), var(--shadow-sm);
  backdrop-filter: blur(10px);
  overflow: hidden;
  transition: width var(--transition-normal), color var(--transition-fast),
    background var(--transition-fast), border-color var(--transition-fast);
}
.outline-entry {
  position: absolute;
  top: 50%;
  right: 0;
  z-index: 10;
  width: 40px;
  height: 104px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  transform: translateY(-50%);
}
.outline-entry:hover .outline-toggle-btn,
.outline-toggle-btn:focus-visible,
.outline-toggle-btn.active {
  color: var(--text-primary);
  background: color-mix(in srgb, var(--primary-color) 8%, var(--bg-surface));
}
.outline-entry:hover .outline-toggle-btn,
.outline-toggle-btn:focus-visible,
.outline-toggle-btn.active {
  border-color: color-mix(in srgb, var(--primary-color) 62%, var(--border-default));
  box-shadow: -6px 0 22px color-mix(in srgb, var(--primary-color) 14%, transparent), var(--shadow-sm);
}
.outline-toggle-btn:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: -2px;
}
.outline-toggle-content {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  opacity: 1;
  transition: opacity var(--transition-fast);
}
.outline-toggle-content svg {
  position: static;
  flex-shrink: 0;
}
.outline-toggle-label {
  color: currentColor;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.25;
  letter-spacing: 0.18em;
  white-space: nowrap;
  writing-mode: vertical-rl;
  text-orientation: upright;
}
.outline-handle {
  display: none;
}
.outline-toggle-btn.active {
  color: var(--primary-color);
}

.outline-panel {
  position: absolute;
  top: 0;
  right: 0;
  height: 100%;
  z-index: 9;
  display: flex;
  flex-direction: column;
  width: min(320px, 88vw);
  max-width: none;
  background: rgba(var(--bg-deep-rgb), 0.92);
  backdrop-filter: blur(12px);
  border-left: 1px solid var(--border-default);
  box-shadow: -18px 0 42px rgba(0, 0, 0, 0.18);
  overflow: hidden;
}

.outline-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-default);
  flex-shrink: 0;
}

.outline-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.outline-close {
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
}
.outline-close:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.outline-timeline {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px 12px 20px;
  position: relative;
}
.outline-timeline::before {
  content: "";
  position: absolute;
  left: 26px;
  top: 20px;
  bottom: 20px;
  width: 1px;
  background: var(--border-default);
}

.timeline-node {
  position: relative;
  padding: 8px 0 8px 20px;
  cursor: pointer;
  transition: all var(--transition-fast);
}
.timeline-node:hover {
  background: var(--bg-hover);
  border-radius: var(--radius-sm);
}

.timeline-dot {
  position: absolute;
  left: 2px;
  top: 14px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--primary-color);
  border: 2px solid var(--bg-deep);
  z-index: 1;
}
.timeline-node:hover .timeline-dot {
  transform: scale(1.3);
  transition: transform var(--transition-fast);
}

.timeline-content {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.timeline-time {
  font-size: 10px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  letter-spacing: 0.02em;
}

.timeline-text {
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.timeline-node:hover .timeline-text {
  color: var(--text-primary);
}

/* Outline slide transition */
.outline-slide-enter-active,
.outline-slide-leave-active {
  transition: transform 0.25s ease, opacity 0.25s ease;
}
.outline-slide-enter-from,
.outline-slide-leave-to {
  transform: translateX(100%);
  opacity: 0;
}

</style>
