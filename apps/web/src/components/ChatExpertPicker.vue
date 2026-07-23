<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { NPopover } from "naive-ui";
import { useExpertStore } from "../stores/expert.js";
import { useSessionStore } from "../stores/session.js";
import { useI18n } from "../i18n/index.js";
import type { ExpertDto } from "@pi-web-ui/shared";

const props = defineProps<{ sessionId: string }>();

const expertStore = useExpertStore();
const sessionStore = useSessionStore();
const { t } = useI18n();
const showPopover = ref(false);
const saving = ref(false);

const selectedExpertId = computed(() =>
  sessionStore.sessions.find((session) => session.id === props.sessionId)?.expertId
    ?? (sessionStore.current?.id === props.sessionId ? sessionStore.current.expertId : null),
);
const selectedExpert = computed(() =>
  expertStore.experts.find((expert) => expert.id === selectedExpertId.value) ?? null,
);

onMounted(async () => {
  if (!expertStore.experts.length) await expertStore.loadAll();
});

watch(() => props.sessionId, async () => {
  if (!expertStore.experts.length) await expertStore.loadAll();
});

async function selectExpert(expert: ExpertDto) {
  if (saving.value || expert.id === selectedExpertId.value) return;
  saving.value = true;
  try {
    await sessionStore.setExpert(props.sessionId, expert.id);
    showPopover.value = false;
  } finally {
    saving.value = false;
  }
}

async function clearExpert() {
  if (saving.value || !selectedExpertId.value) return;
  saving.value = true;
  try {
    await sessionStore.setExpert(props.sessionId, null);
    showPopover.value = false;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <NPopover v-model:show="showPopover" placement="top-start" trigger="click" :width="340">
    <template #trigger>
      <button
        class="expert-picker-trigger"
        :class="{ active: selectedExpert }"
        :title="selectedExpert ? t('expert.chat.active', { name: selectedExpert.name }) : t('expert.chat.pick')"
      >
        <span v-if="selectedExpert" class="expert-trigger-icon">{{ selectedExpert.icon }}</span>
        <svg v-else width="14" height="14" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <circle cx="9" cy="5.5" r="3" stroke="currentColor" stroke-width="1.35" />
          <path d="M3.5 15c.6-3 2.5-4.6 5.5-4.6s4.9 1.6 5.5 4.6" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" />
          <path d="M14.1 4.3l.65.65 1.3-1.3" stroke="currentColor" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
    </template>

    <div class="expert-picker-body">
      <div class="expert-picker-header">
        <span class="expert-picker-title">{{ t('expert.chat.pick') }}</span>
        <button
          v-if="selectedExpert"
          class="expert-clear"
          :disabled="saving"
          @click="clearExpert"
        >{{ t('expert.chat.clear') }}</button>
      </div>
      <p class="expert-picker-hint">{{ t('expert.chat.hint') }}</p>
      <div v-if="!expertStore.experts.length" class="expert-picker-empty">
        {{ t('expert.empty') }}
      </div>
      <div v-else class="expert-picker-list">
        <button
          v-for="expert in expertStore.experts"
          :key="expert.id"
          class="expert-picker-item"
          :class="{ selected: expert.id === selectedExpertId }"
          :disabled="saving"
          @click="selectExpert(expert)"
        >
          <span class="expert-item-icon">{{ expert.icon }}</span>
          <span class="expert-item-copy">
            <span class="expert-item-name">{{ expert.name }}</span>
            <span class="expert-item-description">{{ expert.description }}</span>
          </span>
          <svg v-if="expert.id === selectedExpertId" class="expert-selected-mark" width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M2.5 7.2l2.8 2.8 6.2-6.1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  </NPopover>
  <span v-if="selectedExpert" class="active-expert-chip" :title="t('expert.chat.active', { name: selectedExpert.name })">
    <span>{{ selectedExpert.icon }}</span>{{ selectedExpert.name }}
    <button class="active-expert-clear" :disabled="saving" :title="t('expert.chat.clear')" @click="clearExpert">×</button>
  </span>
</template>

<style scoped>
.expert-picker-trigger {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
  flex-shrink: 0;
}
.expert-picker-trigger:hover, .expert-picker-trigger.active {
  border-color: var(--accent);
  color: var(--text-primary);
  background: var(--bg-hover);
}
.expert-trigger-icon { font-size: 14px; line-height: 1; }
.expert-picker-body { display: flex; flex-direction: column; gap: 7px; }
.expert-picker-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.expert-picker-title { font-size: 13px; font-weight: 650; color: var(--text-primary); }
.expert-picker-hint { margin: 0; font-size: 11px; line-height: 1.45; color: var(--text-muted); }
.expert-clear {
  border: 0;
  padding: 2px 0;
  background: transparent;
  color: var(--accent);
  font-size: 11px;
  cursor: pointer;
}
.expert-clear:disabled, .active-expert-clear:disabled { cursor: default; opacity: .55; }
.expert-picker-list { display: flex; max-height: 300px; flex-direction: column; overflow-y: auto; }
.expert-picker-item {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  width: 100%;
  padding: 8px 6px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.expert-picker-item:hover, .expert-picker-item.selected { background: var(--bg-hover); }
.expert-picker-item:disabled { cursor: default; }
.expert-item-icon { flex: 0 0 23px; font-size: 18px; line-height: 20px; text-align: center; }
.expert-item-copy { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 2px; }
.expert-item-name { color: var(--text-primary); font-size: 12px; font-weight: 600; }
.expert-item-description { display: -webkit-box; overflow: hidden; color: var(--text-muted); font-size: 11px; line-height: 1.35; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.expert-selected-mark { flex: 0 0 auto; margin-top: 4px; color: var(--accent); }
.expert-picker-empty { padding: 14px 0; color: var(--text-muted); font-size: 12px; text-align: center; }
.active-expert-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 180px;
  height: 26px;
  padding: 0 5px 0 7px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border-default));
  border-radius: var(--radius-sm);
  background: var(--bg-hover);
  color: var(--text-primary);
  font-size: 11px;
  line-height: 1;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.active-expert-clear {
  width: 17px;
  height: 17px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 15px;
  line-height: 15px;
}
.active-expert-clear:hover { background: var(--border-default); color: var(--text-primary); }
</style>
