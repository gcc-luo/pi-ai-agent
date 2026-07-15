<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "../i18n/index.js";

export interface KbCallState {
  phase: "searching" | "done" | "empty" | "failed";
  query: string;
  hits?: { localId: number; chunkId: number; kbName: string; fileName: string; titlePath: string | null; pageStart: number | null; pageEnd: number | null }[];
  durationMs?: number;
  error?: string;
}

defineProps<{
  state: KbCallState;
}>();

const { t } = useI18n();
const expanded = ref(false);
</script>

<template>
  <div class="kb-call-card" :class="state.phase">
    <!-- Searching -->
    <template v-if="state.phase === 'searching'">
      <div class="kb-call-row">
        <span class="kb-call-spinner" />
        <span class="kb-call-text">{{ t('kb.chat.card.searching') }}</span>
      </div>
    </template>

    <!-- Done -->
    <template v-else-if="state.phase === 'done'">
      <div class="kb-call-row kb-call-header" @click="expanded = !expanded">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" class="kb-call-check">
          <circle cx="6" cy="6" r="5" stroke="currentColor" stroke-width="1.2" />
          <path d="M4 6l1.5 1.5L8 4.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <span class="kb-call-text">
          {{ t('kb.chat.card.done', {
            chunks: state.hits?.length ?? 0,
            files: new Set(state.hits?.map((h) => h.fileName) ?? []).size,
            ms: state.durationMs ?? 0,
          }) }}
        </span>
        <svg
          v-if="(state.hits?.length ?? 0) > 0"
          class="kb-call-chevron"
          :class="{ open: expanded }"
          width="10" height="10" viewBox="0 0 10 10" fill="none"
        >
          <path d="M3 4l2 2 2-2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </div>
      <div v-if="expanded && state.hits?.length" class="kb-call-hits">
        <div v-for="hit in state.hits" :key="hit.localId" class="kb-call-hit">
          <span class="hit-id">[{{ hit.localId }}]</span>
          <span class="hit-file">{{ hit.fileName }}</span>
          <span v-if="hit.titlePath" class="hit-title">{{ hit.titlePath }}</span>
          <span v-if="hit.pageStart != null" class="hit-page">
            p.{{ hit.pageStart }}{{ hit.pageEnd != null && hit.pageEnd !== hit.pageStart ? `–${hit.pageEnd}` : "" }}
          </span>
        </div>
      </div>
    </template>

    <!-- Empty -->
    <template v-else-if="state.phase === 'empty'">
      <div class="kb-call-row">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" class="kb-call-warn">
          <circle cx="6" cy="6" r="5" stroke="currentColor" stroke-width="1.2" />
          <path d="M4 4l4 4M8 4l-4 4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
        </svg>
        <span class="kb-call-text">{{ t('kb.chat.card.empty', { query: state.query }) }}</span>
      </div>
    </template>

    <!-- Failed -->
    <template v-else-if="state.phase === 'failed'">
      <div class="kb-call-row">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" class="kb-call-error">
          <circle cx="6" cy="6" r="5" stroke="currentColor" stroke-width="1.2" />
          <path d="M6 4v3M6 8.5v.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
        </svg>
        <span class="kb-call-text kb-call-error-text">
          {{ t('kb.chat.card.failed') }}
          <span v-if="state.error" class="kb-call-error-detail">: {{ state.error }}</span>
        </span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.kb-call-card {
  margin-top: 6px;
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  font-size: 11px;
  line-height: 1.4;
  border: 1px solid var(--border-subtle);
  background: var(--bg-elevated);
}
.kb-call-card.searching {
  border-color: var(--accent-dim);
  background: var(--bg-elevated);
}
.kb-call-card.done {
  border-color: var(--green, #22c55e);
  border-color: rgba(34, 197, 94, 0.3);
}
.kb-call-card.empty {
  border-color: var(--border-default);
}
.kb-call-card.failed {
  border-color: var(--rose, #f43f5e);
  border-color: rgba(244, 63, 94, 0.3);
  background: var(--rose-dim, rgba(244, 63, 94, 0.06));
}

.kb-call-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.kb-call-header {
  cursor: pointer;
  user-select: none;
}
.kb-call-header:hover .kb-call-text {
  color: var(--text-primary);
}

.kb-call-text {
  font-family: var(--font-mono);
  color: var(--text-secondary);
}

/* Searching */
.kb-call-spinner {
  width: 10px;
  height: 10px;
  border: 1.5px solid var(--accent-dim);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: kbCallSpin 0.7s linear infinite;
  flex-shrink: 0;
}
@keyframes kbCallSpin {
  to { transform: rotate(360deg); }
}

/* Done */
.kb-call-check {
  color: var(--green, #22c55e);
  flex-shrink: 0;
}
.kb-call-chevron {
  color: var(--text-muted);
  flex-shrink: 0;
  transition: transform var(--transition-fast);
  margin-left: auto;
}
.kb-call-chevron.open {
  transform: rotate(180deg);
}

.kb-call-hits {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.kb-call-hit {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px;
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: 10px;
}
.kb-call-hit:hover {
  background: var(--bg-hover);
}
.hit-id {
  color: var(--accent);
  font-weight: 700;
  flex-shrink: 0;
}
.hit-file {
  color: var(--text-primary);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hit-title {
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 160px;
}
.hit-page {
  margin-left: auto;
  color: var(--text-muted);
  flex-shrink: 0;
}

/* Empty / Failed */
.kb-call-warn {
  color: var(--text-muted);
  flex-shrink: 0;
}
.kb-call-error {
  color: var(--rose, #f43f5e);
  flex-shrink: 0;
}
.kb-call-error-text {
  color: var(--rose, #f43f5e);
}
.kb-call-error-detail {
  color: var(--text-muted);
  font-weight: 400;
}
</style>
