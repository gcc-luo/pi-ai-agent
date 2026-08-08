<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "../i18n/index.js";
import {
  formatProcessingDuration,
  type AgentActivity,
  type AgentActivityLabel,
} from "../utils/chat-run-presentation.js";

const props = defineProps<{
  activity: AgentActivity;
  expanded: boolean;
  canToggle: boolean;
}>();

defineEmits<{ (event: "toggle"): void }>();

const { t } = useI18n();
const detailsId = computed(() => `agent-activity-${props.activity.runId.replace(/[^a-zA-Z0-9_-]/g, "-")}`);

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
      const text = value.content
        .filter((part): part is { text: string } => !!part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string")
        .map((part) => part.text)
        .join("\n");
      if (text) return text;
    }
  }
  return formatJson(result);
}

function toolPreview(args: unknown): string {
  if (!args || typeof args !== "object") return formatJson(args);
  const value = args as Record<string, unknown>;
  const preview = value.command ?? value.path ?? value.query ?? value.url;
  return typeof preview === "string" ? preview : formatJson(args);
}
</script>

<template>
  <section class="agent-activity" :class="activity.status">
    <component
      :is="canToggle ? 'button' : 'div'"
      :type="canToggle ? 'button' : undefined"
      class="activity-summary"
      :class="[activity.status, { toggleable: canToggle }]"
      :aria-expanded="canToggle ? expanded : undefined"
      :aria-controls="canToggle ? detailsId : undefined"
      @click="canToggle && $emit('toggle')"
    >
      <span class="activity-state-icon" aria-hidden="true">
        <span v-if="activity.status === 'running'" class="activity-spinner" />
        <span v-else-if="activity.status === 'waiting_permission'">…</span>
        <span v-else-if="activity.status === 'failed'">!</span>
        <span v-else-if="activity.status === 'interrupted'">■</span>
        <span v-else>✓</span>
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
              : t('chat.processedDuration', { duration: formatProcessingDuration(activity.durationMs) }) }}
      </span>
      <template v-if="activity.status === 'running' || activity.status === 'waiting_permission'">
        <span class="activity-separator" aria-hidden="true">·</span>
        <span>{{ formatProcessingDuration(activity.durationMs ?? 0) }}</span>
      </template>
      <template v-if="activity.items.length > 0">
        <span class="activity-separator" aria-hidden="true">·</span>
        <span>{{ t('chat.activityStepCount', { count: activity.items.length }) }}</span>
      </template>
      <template v-if="activity.failedCount > 0">
        <span class="activity-separator" aria-hidden="true">·</span>
        <span class="activity-failures">{{ t('chat.activityFailureCount', { count: activity.failedCount }) }}</span>
      </template>
      <template v-else-if="activity.status === 'running'">
        <span class="activity-separator activity-current-separator" aria-hidden="true">·</span>
        <span class="activity-current">
          {{ t('chat.activityCurrent', { action: activityLabel(activity.currentLabel) }) }}
        </span>
      </template>
      <svg v-if="canToggle" class="activity-chevron" :class="{ expanded }" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path d="M4.5 2.5 8 6 4.5 9.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </component>

    <div v-if="expanded" :id="detailsId" class="activity-details">
      <div
        v-for="item in activity.items"
        :key="item.id"
        class="activity-item"
        :class="[item.kind, item.status]"
      >
        <div class="activity-item-heading">
          <span class="activity-item-mark" aria-hidden="true">
            {{ item.status === 'failed' ? '!' : item.status === 'running' ? '›' : '·' }}
          </span>
          <span v-if="item.kind === 'tool' && item.part.kind === 'tool_call'" class="activity-tool-name">
            {{ item.part.name }}
          </span>
          <span v-else>{{ activityLabel(item.label) }}</span>
          <span class="activity-item-status">
            {{ item.status === 'running'
              ? t('chat.toolRunning')
              : item.status === 'failed'
                ? t('chat.toolFailed')
                : t('chat.toolDone') }}
          </span>
        </div>

        <div v-if="item.part.kind === 'thinking'" class="activity-thinking">
          {{ item.part.text }}
        </div>
        <template v-else-if="item.part.kind === 'tool_call'">
          <div class="activity-tool-preview">{{ toolPreview(item.part.args) }}</div>
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
        </template>
        <pre v-else-if="item.part.kind === 'raw'" class="activity-raw">{{ formatJson(item.part.data) }}</pre>
      </div>
    </div>
  </section>
</template>

<style scoped>
.agent-activity {
  min-width: 0;
  margin: 2px 0 6px;
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
  text-align: left;
}

.activity-summary.toggleable {
  cursor: pointer;
}

.activity-summary.toggleable:hover,
.activity-summary.toggleable:focus-visible {
  color: var(--text-secondary);
}

.activity-summary.failed,
.activity-failures,
.activity-item.failed .activity-item-heading {
  color: var(--rose, #e0526f);
}

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
  border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: activity-spin 0.8s linear infinite;
}

.activity-state,
.activity-failures {
  flex: 0 0 auto;
  font-weight: 600;
}

.activity-separator {
  color: var(--text-faint, var(--text-muted));
}

.activity-current {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.activity-chevron {
  margin-left: auto;
  flex: 0 0 auto;
  transition: transform var(--transition-fast);
}

.activity-chevron.expanded {
  transform: rotate(90deg);
}

.activity-details {
  margin-left: 7px;
  padding: 2px 0 4px 17px;
  border-left: 1px solid var(--border-default);
}

.activity-item {
  padding: 7px 0;
  border-bottom: 1px solid color-mix(in srgb, var(--border-default) 55%, transparent);
}

.activity-item:last-child {
  border-bottom: 0;
}

.activity-item-heading {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.activity-item-mark {
  width: 10px;
  flex: 0 0 auto;
  text-align: center;
}

.activity-tool-name {
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-weight: 600;
}

.activity-item-status {
  margin-left: auto;
  flex: 0 0 auto;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.activity-thinking,
.activity-tool-preview {
  margin: 4px 0 0 17px;
  color: var(--text-muted);
  white-space: pre-wrap;
  word-break: break-word;
}

.activity-thinking {
  font-style: italic;
}

.activity-section,
.activity-raw {
  margin: 7px 0 0 17px;
}

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

@keyframes activity-spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 720px) {
  .activity-current-separator,
  .activity-current {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .activity-spinner { animation: none; }
  .activity-chevron { transition: none; }
}
</style>
