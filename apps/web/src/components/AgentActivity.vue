<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "../i18n/index.js";
import {
  activityTargetForTool,
  formatProcessingDuration,
  type AgentActivity,
  type AgentActivityItem,
  type AgentActivityLabel,
} from "../utils/chat-run-presentation.js";

const PREVIEW_LIMIT = 5;

const props = defineProps<{
  activity: AgentActivity;
  expanded: boolean;
  canToggle: boolean;
}>();

defineEmits<{ (event: "toggle"): void }>();

const { t } = useI18n();
const detailsId = computed(() => `agent-activity-${props.activity.runId.replace(/[^a-zA-Z0-9_-]/g, "-")}`);
const isLive = computed(() => props.activity.status === "running" || props.activity.status === "waiting_permission");
const showToggle = computed(() => props.canToggle && (
  isLive.value ? props.activity.items.length > PREVIEW_LIMIT : props.activity.items.length > 0
));
const visibleItems = computed(() => {
  if (props.expanded) return props.activity.items;
  if (isLive.value) return props.activity.items.slice(-PREVIEW_LIMIT);
  return [];
});

const labelKeys: Record<AgentActivityLabel, string> = {
  analyzeRequest: "chat.activityAnalyzeRequest",
  searchCode: "chat.activitySearchCode",
  readFiles: "chat.activityReadFiles",
  modifyFiles: "chat.activityModifyFiles",
  verifyResults: "chat.activityVerifyResults",
  useBrowser: "chat.activityUseBrowser",
  useComputer: "chat.activityUseComputer",
  executeOperation: "chat.activityExecuteOperation",
};

function activityLabel(label: AgentActivityLabel): string {
  return t(labelKeys[label]);
}

function formatJson(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

function toolResultText(result: unknown): string {
  if (typeof result === "string") return result;
  if (Array.isArray(result)) return result.map(toolResultText).join("\n");
  if (result && typeof result === "object") {
    const value = result as Record<string, unknown>;
    if (typeof value.content === "string") return value.content;
    if (Array.isArray(value.content)) {
      const resultText = value.content
        .filter((part): part is { text: string } => !!part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string")
        .map((part) => part.text)
        .join("\n");
      if (resultText) return resultText;
    }
  }
  return formatJson(result);
}

function compactText(value: string, limit = 120): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function itemTitle(item: AgentActivityItem): string {
  if (item.part.kind === "text") return compactText(item.part.text);
  if (item.part.kind === "thinking") {
    if (item.status === "running") return t("chat.thinkingRunning");
    if (item.durationMs !== null && item.durationMs !== undefined) {
      return t("chat.thinkingWorked", { duration: formatProcessingDuration(item.durationMs) });
    }
    return t("chat.thinkingCompleted");
  }
  if (item.part.kind === "tool_call") {
    const target = activityTargetForTool(item.part.name, item.part.args);
    return target ? `${activityLabel(item.label)} ${target}` : activityLabel(item.label);
  }
  return activityLabel(item.label);
}

const completedCounts = computed(() => {
  const counts = new Map<AgentActivityLabel, number>();
  for (const item of props.activity.items) {
    if (item.kind !== "tool") continue;
    counts.set(item.label, (counts.get(item.label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([label, count]) => t("chat.activityTypeCount", { action: activityLabel(label), count }));
});
</script>

<template>
  <section class="agent-activity" :class="activity.status">
    <component
      :is="showToggle ? 'button' : 'div'"
      :type="showToggle ? 'button' : undefined"
      class="activity-summary"
      :class="[activity.status, { toggleable: showToggle }]"
      :aria-expanded="showToggle ? expanded : undefined"
      :aria-controls="showToggle ? detailsId : undefined"
      @click="showToggle && $emit('toggle')"
    >
      <span class="activity-state-icon" aria-hidden="true">
        <span v-if="activity.status === 'running'" class="activity-spinner" />
        <span v-else-if="activity.status === 'waiting_permission'">…</span>
        <span v-else-if="activity.status === 'failed'">!</span>
        <span v-else-if="activity.status === 'interrupted'">■</span>
        <svg v-else width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M2 4.4 7 1.8l5 2.6L7 7 2 4.4Z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round" />
          <path d="m2 7 5 2.6L12 7M2 9.6l5 2.6 5-2.6" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </span>
      <span class="activity-state">
        {{ activity.status === 'running'
          ? t('chat.activityRunning')
          : activity.status === 'waiting_permission'
            ? t('chat.activityWaitingPermission')
            : activity.status === 'failed'
              ? t('chat.activityFailed')
              : activity.status === 'interrupted'
                ? t('chat.activityInterrupted')
                : activity.durationMs === null
                  ? t('chat.activityCompleted')
                  : t('chat.activityWorked', { duration: formatProcessingDuration(activity.durationMs) }) }}
      </span>
      <template v-if="isLive">
        <span class="activity-separator" aria-hidden="true">·</span>
        <span>{{ formatProcessingDuration(activity.durationMs ?? 0) }}</span>
      </template>
      <template v-else v-for="countLabel in completedCounts" :key="countLabel">
        <span class="activity-separator" aria-hidden="true">·</span>
        <span class="activity-count">{{ countLabel }}</span>
      </template>
      <template v-if="activity.failedCount > 0">
        <span class="activity-separator" aria-hidden="true">·</span>
        <span class="activity-failures">{{ t('chat.activityFailureCount', { count: activity.failedCount }) }}</span>
      </template>
      <template v-else-if="isLive && visibleItems.length === 0">
        <span class="activity-separator activity-current-separator" aria-hidden="true">·</span>
        <span class="activity-current">{{ activityLabel(activity.currentLabel) }}</span>
      </template>
      <svg v-if="showToggle" class="activity-chevron" :class="{ expanded }" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path d="M4.5 2.5 8 6 4.5 9.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </component>

    <div v-if="visibleItems.length" :id="detailsId" class="activity-details" :class="{ preview: !expanded }">
      <div
        v-for="item in visibleItems"
        :key="item.id"
        class="activity-item"
        :class="[item.kind, item.status]"
      >
        <details v-if="item.part.kind === 'thinking'" class="activity-work-step thinking-step">
          <summary class="activity-item-heading">
            <span class="activity-item-mark thinking-mark" aria-hidden="true">✦</span>
            <span class="activity-item-title">{{ itemTitle(item) }}</span>
            <svg class="activity-item-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M4.5 2.5 8 6 4.5 9.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </summary>
          <div class="activity-thinking">{{ item.part.text }}</div>
        </details>

        <details v-else-if="item.part.kind === 'tool_call'" class="activity-work-step">
          <summary class="activity-item-heading">
            <span class="activity-item-mark" aria-hidden="true">
              <span v-if="item.status === 'running'" class="activity-spinner small" />
              <span v-else-if="item.status === 'failed'" class="activity-error-mark">!</span>
              <span v-else class="activity-done-mark">✓</span>
            </span>
            <span class="activity-item-title">{{ itemTitle(item) }}</span>
            <svg class="activity-item-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M4.5 2.5 8 6 4.5 9.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </summary>
          <div class="activity-step-detail">
            <div class="activity-tool-meta">
              <span>Tool</span>
              <code>{{ item.part.name }}</code>
            </div>
            <div class="activity-section">
              <span class="activity-label">{{ t('chat.toolArgs') }}</span>
              <pre>{{ formatJson(item.part.args) }}</pre>
            </div>
            <div v-if="item.part.progress?.length" class="activity-section">
              <span class="activity-label">{{ t('chat.toolProgress') }}</span>
              <pre>{{ formatJson(item.part.progress) }}</pre>
            </div>
            <div v-if="item.part.result !== undefined" class="activity-section">
              <span class="activity-label">{{ t('chat.toolResult') }}</span>
              <pre>{{ toolResultText(item.part.result) }}</pre>
            </div>
          </div>
        </details>

        <div v-else-if="item.part.kind === 'text'" class="activity-item-heading commentary-step">
          <span class="activity-item-mark" aria-hidden="true">·</span>
          <span class="activity-item-title">{{ itemTitle(item) }}</span>
        </div>

        <details v-else-if="item.part.kind === 'raw'" class="activity-work-step">
          <summary class="activity-item-heading">
            <span class="activity-item-mark" aria-hidden="true">·</span>
            <span class="activity-item-title">{{ itemTitle(item) }}</span>
            <svg class="activity-item-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M4.5 2.5 8 6 4.5 9.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </summary>
          <pre class="activity-raw">{{ formatJson(item.part.data) }}</pre>
        </details>
      </div>
    </div>
  </section>
</template>

<style scoped>
.agent-activity {
  min-width: 0;
  width: min(880px, 100%);
  margin: 2px 0 8px;
  color: var(--text-muted);
  font-size: 12px;
}

.activity-summary {
  width: 100%;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 0;
  border: 0;
  background: transparent;
  color: var(--text-muted);
  cursor: default;
  font: inherit;
  text-align: left;
}

.activity-summary.toggleable { cursor: pointer; }
.activity-summary.toggleable:hover,
.activity-summary.toggleable:focus-visible { color: var(--text-secondary); }

.activity-summary.failed,
.activity-failures,
.activity-item.failed .activity-item-heading { color: var(--rose, #e0526f); }

.activity-state-icon {
  width: 14px;
  height: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  font-weight: 700;
}

.activity-spinner {
  width: 10px;
  height: 10px;
  box-sizing: border-box;
  border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: activity-spin 0.8s linear infinite;
}

.activity-spinner.small { width: 9px; height: 9px; }
.activity-state,
.activity-failures { flex: 0 0 auto; font-weight: 600; }
.activity-separator { color: var(--text-faint, var(--text-muted)); }
.activity-current,
.activity-count { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.activity-chevron {
  margin-left: auto;
  flex: 0 0 auto;
  transition: transform var(--transition-fast);
}
.activity-chevron.expanded { transform: rotate(90deg); }

.activity-details {
  margin-left: 7px;
  padding: 1px 0 4px 17px;
  border-left: 1px solid color-mix(in srgb, var(--border-default) 80%, transparent);
}

.activity-item { min-width: 0; padding: 3px 0; }
.activity-work-step { min-width: 0; }
.activity-item-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 2px 0;
  list-style: none;
  color: var(--text-muted);
  cursor: pointer;
}
.activity-item-heading::-webkit-details-marker { display: none; }
.commentary-step { cursor: default; }
.activity-item-mark {
  width: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
}
.thinking-mark { color: var(--accent); font-size: 13px; }
.activity-done-mark { color: var(--text-faint, var(--text-muted)); }
.activity-error-mark { color: var(--rose, #e0526f); font-weight: 700; }
.activity-item-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.activity-item-chevron {
  margin-left: auto;
  flex: 0 0 auto;
  opacity: 0.65;
  transition: transform var(--transition-fast);
}
.activity-work-step[open] > .activity-item-heading .activity-item-chevron { transform: rotate(90deg); }

.activity-thinking {
  margin: 5px 18px 3px 22px;
  padding: 8px 10px;
  border-left: 1px solid var(--border-default);
  color: var(--text-muted);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.activity-step-detail {
  margin: 5px 18px 2px 22px;
  padding: 8px 10px;
  border: 1px solid color-mix(in srgb, var(--border-default) 72%, transparent);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--bg-elevated) 68%, transparent);
}

.activity-tool-meta { display: flex; align-items: center; gap: 7px; color: var(--text-muted); font-size: 10px; }
.activity-tool-meta code { color: var(--text-primary); font-family: var(--font-mono); }
.activity-section,
.activity-raw { margin: 7px 0 0; }
.activity-label {
  display: block;
  margin-bottom: 3px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.activity-section pre,
.activity-raw {
  max-height: 280px;
  margin: 0;
  padding: 7px 9px;
  overflow: auto;
  border-radius: var(--radius-sm);
  background: var(--bg-void, rgba(0, 0, 0, 0.035));
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

@keyframes activity-spin { to { transform: rotate(360deg); } }

@media (max-width: 720px) {
  .activity-count:nth-of-type(n + 2),
  .activity-current-separator,
  .activity-current { display: none; }
}

@media (prefers-reduced-motion: reduce) {
  .activity-spinner { animation: none; }
  .activity-chevron,
  .activity-item-chevron { transition: none; }
}
</style>
