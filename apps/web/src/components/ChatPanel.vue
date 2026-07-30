<script setup lang="ts">
import { ref, computed, onMounted, nextTick, watch } from "vue";
import { NInput } from "naive-ui";
import { useAgentStore, partsFromPersisted } from "../stores/agent.js";
import { api } from "../api/client.js";
import { useI18n } from "../i18n/index.js";
import SkillSelect from "./SkillSelect.vue";
import ImportSkillDialog from "./ImportSkillDialog.vue";
import { useSkillStore } from "../stores/skill.js";
import { useKbBindingStore } from "../stores/kb-binding.js";
import { useKbStore } from "../stores/kb.js";
import ChatKbPicker from "./ChatKbPicker.vue";
import ChatExpertPicker from "./ChatExpertPicker.vue";
import ChatKbBanner from "./ChatKbBanner.vue";
import ChatKbCallCard from "./ChatKbCallCard.vue";
import type { KbCallState } from "./ChatKbCallCard.vue";
import type { MessagePart, ArtifactItem, ArtifactValidation } from "@pi-web-ui/shared";
import { renderMarkdown } from "../utils/markdown.js";
import { TIP_BLOCK_RE, activeTipBody, activeTipLabel } from "../utils/skill-tips.js";
import { stripKbContext, getKbSearchMeta, renderKbCitations, type KbSearchMeta } from "../utils/kb-context.js";
import { parseArtifacts } from "../utils/artifacts.js";
import ArtifactCard from "./ArtifactCard.vue";

const props = defineProps<{ sessionId: string; projectId: string }>();
const emit = defineEmits<{ (e: "select-file", path: string): void }>();
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

// Pi can finish one assistant message to execute a tool and then start another
// model turn. Use the run lifecycle so the control remains in its stop state
// throughout that complete sequence.
const isBusy = computed(() => agent.isSessionBusy(props.sessionId));
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

/** Cumulative session tokens with animated number transitions. */
const displayedInput = ref(0);
const displayedOutput = ref(0);
let animFrameInput: number | null = null;
let animFrameOutput: number | null = null;

function animateNumber(from: number, to: number, duration: number, onUpdate: (v: number) => void, onDone: () => void): number {
  const start = performance.now();
  const diff = to - from;
  function tick(now: number) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    // easeOutCubic for smooth deceleration
    const eased = 1 - Math.pow(1 - progress, 3);
    onUpdate(from + diff * eased);
    if (progress < 1) {
      return requestAnimationFrame(tick);
    } else {
      onDone();
      return null;
    }
  }
  return requestAnimationFrame(tick);
}

watch(
  () => agent.tokensFor(props.sessionId),
  ({ input, output }) => {
    if (animFrameInput !== null) cancelAnimationFrame(animFrameInput);
    if (animFrameOutput !== null) cancelAnimationFrame(animFrameOutput);
    const fromInput = displayedInput.value;
    const fromOutput = displayedOutput.value;
    if (input !== fromInput) {
      animFrameInput = animateNumber(fromInput, input, 600, (v) => { displayedInput.value = v; }, () => { animFrameInput = null; });
    }
    if (output !== fromOutput) {
      animFrameOutput = animateNumber(fromOutput, output, 600, (v) => { displayedOutput.value = v; }, () => { animFrameOutput = null; });
    }
  },
  { immediate: true, deep: true }
);

const tokenLabel = computed(() => {
  const fmt = (n: number) => {
    const rounded = Math.round(n);
    if (rounded <= 0) return "0";
    if (rounded >= 1000) return `${(rounded / 1000).toFixed(1)}K`;
    return String(rounded);
  };
  return { input: fmt(displayedInput.value), output: fmt(displayedOutput.value) };
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
  persistedMessages.value = await api.listMessages(props.sessionId);
  // Restore kb_search metadata from persisted messages
  const restored: Record<string, KbCallState> = {};
  let historicalInput = 0;
  let historicalOutput = 0;
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
    // Accumulate token usage from assistant message metadata
    if (m.role === "assistant" && m.metadata) {
      const usage = m.metadata.usage as { input?: number; output?: number } | undefined;
      if (usage) {
        historicalInput += usage.input ?? 0;
        historicalOutput += usage.output ?? 0;
      }
    }
  }
  kbSearchByMessage.value = { ...kbSearchByMessage.value, ...restored };
  // Reset and restore historical token totals for this session
  agent.sessionTokens[props.sessionId] = { input: historicalInput, output: historicalOutput };
  await nextTick();
  scrollToBottom();
}

onMounted(async () => {
  // Make office mode the sole Pi writer before loading the canonical history.
  try { await api.activateOfficeSession(props.sessionId); } catch {}
  await loadMessages();
  await kbBindingStore.load(props.sessionId);
  await kbStore.loadAll();
});

watch(() => props.sessionId, async () => {
  kbSearchByMessage.value = {};
  try { await api.activateOfficeSession(props.sessionId); } catch {}
  await loadMessages();
  await kbBindingStore.load(props.sessionId);
});

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

// ─── Scroll-to-bottom button ───────────────────────────────────────────
const showScrollButton = ref(false);

function onMessagesScroll() {
  const el = messagesEl.value;
  if (!el) return;
  // Show when user has scrolled up more than 200px from the bottom
  const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
  showScrollButton.value = distanceFromBottom > 200;
}

function handleClickScrollToBottom() {
  const el = messagesEl.value;
  if (!el) return;
  el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
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
    e.preventDefault();
    if (isBusy.value) {
      agent.interrupt(props.sessionId);
      return;
    }
    send();
  }
}

// Artifact validation cache (path → validation result)
const artifactValidation = ref<Record<string, ArtifactValidation>>({});

const allMessages = computed(() => {
  const persisted = persistedMessages.value.map((m) => ({
    id: m.id,
    role: m.role as "user" | "assistant",
    parts: partsFromPersisted(m.content, m.metadata),
    streaming: false,
    persisted: true,
    createdAt: m.createdAt,
    metadata: m.metadata,
  }));
  const live = messages.value.map((m) => ({
    id: m.id,
    role: m.role,
    parts: m.parts,
    streaming: m.status === "streaming",
    persisted: false,
    createdAt: m.createdAt,
    metadata: null as Record<string, unknown> | null,
  }));
  const all = [...persisted, ...live];
  // Show the AGENT header only on the first message of a consecutive assistant group.
  return all.map((m, i) => {
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
        }
      }
      parts = newParts;
    }
    return {
      ...m,
      parts,
      artifacts,
      showHeader: m.role !== "assistant" || all[i - 1]?.role !== "assistant",
      kbSearch: kbSearchByMessage.value[m.id] ?? null,
      // Build chunkMap from persisted metadata or live search state for citation rendering
      chunkMap: buildChunkMap(m.id, m.metadata),
    };
  });
});

// Validate artifact files exist on disk
watch(allMessages, async (msgs) => {
  const items = msgs.flatMap((m) => m.artifacts);
  if (!items.length) return;
  const toValidate = items.filter((i) => !(i.path in artifactValidation.value));
  if (!toValidate.length) return;
  try {
    const results = await api.validateArtifacts(props.projectId, toValidate);
    for (const r of results) {
      artifactValidation.value[r.path] = r;
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

const sessionErrors = computed(() =>
  agent.errors.filter((e) => e.sessionId === props.sessionId),
);

// Label of the tip that will be auto-injected on send when one of the selected
// skills has an entry in SKILL_TIPS. Drives the inline composer banner so the
// user knows the reminder will be attached before they hit send.
const pendingTipLabel = computed(() => {
  const key = activeTipLabel(selectedSkills.value);
  return key ? t(key) : null;
});</script>

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

    <!-- Messages wrapper (scroll + button) -->
    <div class="messages-wrap">
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

      <div
        v-for="m in allMessages"
        :key="m.id"
        class="msg"
        :class="[m.role, { streaming: m.streaming, continued: !m.showHeader }]"
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
        <div v-else-if="m.showHeader" class="msg-avatar-row">
          <div class="msg-avatar assistant" aria-hidden="true">
            <img src="/panda-agent-avatar-22px.svg" alt="PI Agent" />
          </div>
          <span class="msg-avatar-label">PI Agent</span>
          <span v-if="m.streaming" class="typing-dots">
            <span /><span /><span />
          </span>
        </div>
        <div class="msg-body">
          <template v-for="(p, pi) in m.parts" :key="pi">
            <!-- Image part — show thumbnail in message bubble -->
            <div v-if="p.kind === 'image'" class="msg-image-wrap">
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
                <div v-if="split.text" class="msg-content" v-html="renderMarkdown(split.text)"></div>
              </template>
            </template>
            <div v-else-if="p.kind === 'text'" class="msg-content" v-html="renderKbCitations(renderMarkdown(p.text), sessionChunkMap)"></div>
            <details v-else-if="p.kind === 'thinking'" class="thinking-trace" open>
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
          <!-- Artifact cards (files delivered by the agent) -->
          <div v-if="m.artifacts?.length" class="artifact-cards">
            <ArtifactCard
              v-for="a in m.artifacts"
              :key="a.path"
              :project-id="projectId"
              :artifact="a"
              :exists="artifactValidation[a.path]?.exists ?? true"
              :size="artifactValidation[a.path]?.size ?? null"
              @preview="(p) => emit('select-file', p)"
            />
          </div>
        </div>
        <!-- KB search call card (shown under user messages) -->
        <ChatKbCallCard v-if="m.role === 'user' && m.kbSearch" :state="m.kbSearch" />
        <div
          v-if="m.createdAt"
          class="msg-time"
          :class="m.role"
          :title="formatTimeFull(m.createdAt)"
        >{{ formatTime(m.createdAt) }}</div>
      </div>
      <div v-if="isBusy" class="generating-indicator" role="status" aria-live="polite">
        <span class="generating-spinner" aria-hidden="true" />
        <span>{{ t('chat.generating') }}</span>
        <span class="generating-dots" aria-hidden="true"><i /><i /><i /></span>
      </div>
    </div>

      <Transition name="scroll-btn-fade">
        <button
          v-if="showScrollButton"
          class="scroll-to-bottom-btn"
          :title="t('chat.scrollToBottom')"
          @click="handleClickScrollToBottom"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M8 3v10M4 9l4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
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
        </button>
        <SkillSelect
          @select="onSkillSelect"
          @import="showImportSkill = true"
        />
        <ChatExpertPicker :session-id="sessionId" />
        <ChatKbPicker :session-id="sessionId" />
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
        <span class="token-usage" :title="t('chat.tokenUsage')">
          <span class="token-in"><span class="token-arrow up">↑</span>{{ tokenLabel.input }}</span>
          <span class="token-out"><span class="token-arrow down">↓</span>{{ tokenLabel.output }}</span>
        </span>
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
        <button
          v-if="isBusy"
          class="send-btn stop embedded"
          @click="agent.interrupt(props.sessionId)"
          :title="t('chat.stop')"
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
    <ImportSkillDialog
      data-test="import-skill-dialog"
      :show="showImportSkill"
      @close="showImportSkill = false"
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
  padding: 16px 20px;
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

/* Always follows the final message. It remains visible between tool turns and
   disappears only when Pi reports that the complete agent run has settled. */
.generating-indicator {
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 28px;
  padding: 4px 2px 0 30px;
  color: var(--text-muted);
  font-size: 12px;
}
.generating-spinner {
  width: 11px;
  height: 11px;
  border: 1.5px solid var(--accent-dim);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: generatingSpin 0.7s linear infinite;
}
.generating-dots {
  display: inline-flex;
  gap: 3px;
  align-items: center;
}
.generating-dots i {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: currentColor;
  animation: generatingDot 1.2s ease-in-out infinite;
}
.generating-dots i:nth-child(2) { animation-delay: 0.15s; }
.generating-dots i:nth-child(3) { animation-delay: 0.3s; }
@keyframes generatingSpin { to { transform: rotate(360deg); } }
@keyframes generatingDot {
  0%, 80%, 100% { opacity: 0.25; transform: translateY(0); }
  40% { opacity: 1; transform: translateY(-2px); }
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

/* Assistant ─ left-aligned column: avatar above the body, teal rail anchoring the spine */
.msg.assistant {
  align-self: flex-start;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  max-width: min(880px, 90%);
  padding: 8px 4px 12px 16px;
  border: none;
  background: transparent;
  box-shadow: none;
  border-radius: 0;
  animation: msgInLeft 0.3s var(--ease-out) both;
  margin-bottom: 10px;
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
  margin-top: 7px;
  text-align: right;
  color: var(--text-secondary);
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

/* ─── Artifact Cards ─── */

.artifact-cards {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
  max-width: 420px;
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
  max-height: 4.5em;
  overflow-y: auto;
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

/* Hide tool output and running line when details is collapsed */
.tool-trace details:not([open]) + .tool-output,
.tool-trace details:not([open]) + .tool-running-line {
  display: none;
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
  flex-direction: column;
  gap: 8px;
  padding: 12px 20px 16px;
  border-top: 1px solid var(--border-default);
  background: var(--bg-surface);
  flex-shrink: 0;
}

.composer-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 0;
}

.tool-btn {
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
.tool-btn:hover {
  color: var(--text-primary);
}

.token-usage {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 500;
  color: var(--text-muted);
  letter-spacing: 0.02em;
  white-space: nowrap;
  user-select: none;
}
.token-in, .token-out {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.token-arrow {
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
}
.token-arrow.up { color: #10b981; }
.token-arrow.down { color: #6366f1; }

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
  /* reserve space on the right so embedded send button doesn't cover text */
  padding-right: 96px;
}
.composer-input :deep(.n-input__textarea-el) {
  background: transparent;
  padding-right: 8px;
}

/* Embedded send button — absolutely positioned at bottom-right of the input */
.send-btn.embedded {
  position: absolute;
  right: 6px;
  bottom: 6px;
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
  animation: stopPulse 1.6s ease-in-out infinite;
}
.send-btn.stop:hover {
  background: var(--rose-hover, #e11d48);
  box-shadow: 0 0 0 4px rgba(244, 63, 94, 0.18);
  transform: translateY(-1px);
}
.send-btn.stop:active {
  transform: translateY(0);
}

@keyframes stopPulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(244, 63, 94, 0.0); }
  50%      { box-shadow: 0 0 0 5px rgba(244, 63, 94, 0.16); }
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
</style>
