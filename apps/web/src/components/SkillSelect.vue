<script setup lang="ts">
import { ref, onMounted } from "vue";
import { NPopover } from "naive-ui";
import { useSkillStore } from "../stores/skill.js";
import ConfirmDialog from "./ConfirmDialog.vue";
import { useI18n } from "../i18n/index.js";

const emit = defineEmits<{
  (e: "select", name: string): void;
  (e: "import"): void;
}>();

const skillStore = useSkillStore();
const { t } = useI18n();

const showPopover = ref(false);
const uninstallTarget = ref<string | null>(null);

onMounted(() => { skillStore.loadAll(); });

function selectSkill(name: string) {
  emit("select", name);
  showPopover.value = false;
}

function requestUninstall(name: string) {
  uninstallTarget.value = name;
}

async function confirmUninstall() {
  if (!uninstallTarget.value) return;
  try {
    await skillStore.remove(uninstallTarget.value);
  } catch (e: any) {
    console.error("Failed to uninstall skill:", e);
    alert(`${e.message}`);
  } finally {
    uninstallTarget.value = null;
  }
}
</script>

<template>
  <div class="skill-select">
    <NPopover v-model:show="showPopover" placement="top-start" trigger="click" :width="320">
      <template #trigger>
        <button class="skill-trigger" :class="{ active: skillStore.skills.length }" :title="t('skill.dropdown')">
          <svg width="12" height="12" viewBox="0 0 18 18" fill="none">
            <path d="M3 6l1.5-2.5h9L15 6M3 6v8a1 1 0 001 1h10a1 1 0 001-1V6M3 6h12M7 10h4" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/>
          </svg>
          <span class="skill-trigger-label">{{ t('skill.dropdown') }}</span>
        </button>
      </template>

      <div class="skill-picker-body">
        <div class="skill-picker-header">
          <span class="skill-picker-title">{{ t('skill.dropdown') }}</span>
          <span class="skill-picker-hint">{{ skillStore.skills.length }}</span>
        </div>

        <div v-if="!skillStore.skills.length" class="skill-picker-empty">
          {{ t('skill.empty') }}
        </div>

        <div v-else class="skill-picker-list">
          <div
            v-for="s in skillStore.skills"
            :key="s.name"
            class="skill-item"
            data-test="skill-item"
            @click="selectSkill(s.name)"
          >
            <div class="skill-info">
              <div class="skill-name">{{ s.name }}</div>
              <div class="skill-desc">{{ s.description }}</div>
            </div>
            <button
              class="uninstall-btn"
              data-test="uninstall-btn"
              :title="t('skill.uninstall')"
              @click.stop="requestUninstall(s.name)"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M3 3v7a1 1 0 001 1h4a1 1 0 001-1V3M2 3h8M5 3V2h2v1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
          </div>
        </div>

        <div class="panel-footer">
          <button class="import-btn" data-test="skill-import-btn" @click="emit('import'); showPopover = false">
            + {{ t('skill.import') }}
          </button>
        </div>
      </div>
    </NPopover>

    <ConfirmDialog
      :show="uninstallTarget !== null"
      :title="t('skill.confirmTitle')"
      :message="t('skill.confirmMessage')"
      :confirm-label="t('skill.confirm')"
      :cancel-label="t('skill.cancel')"
      :danger="true"
      @close="uninstallTarget = null"
      @confirm="confirmUninstall"
    />
  </div>
</template>

<style scoped>
.skill-select {
  display: flex;
  align-items: center;
}
.skill-trigger {
  display: flex;
  align-items: center;
  justify-content: center;
  width: auto;
  min-width: 68px;
  height: 26px;
  gap: 5px;
  padding: 0 8px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
  flex-shrink: 0;
}
.skill-trigger-label {
  font-size: 11px;
  white-space: nowrap;
}
.skill-trigger:hover {
  color: var(--text-primary);
}

.skill-picker-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.skill-picker-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.skill-picker-title {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}
.skill-picker-hint {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-muted);
}
.skill-picker-empty {
  padding: 16px 0;
  text-align: center;
  font-size: 12px;
  color: var(--text-muted);
  font-style: italic;
}
.skill-picker-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 320px;
  overflow-y: auto;
}
.skill-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  cursor: pointer;
  transition: background var(--transition-fast);
  border-radius: var(--radius-sm);
}
.skill-item:hover {
  background: var(--bg-hover);
}
.skill-info {
  flex: 1;
  min-width: 0;
}
.skill-name {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}
.skill-desc {
  font-size: 11px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.uninstall-btn {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-faint);
  cursor: pointer;
  opacity: 0;
  transition: all var(--transition-fast);
}
.skill-item:hover .uninstall-btn { opacity: 1; }
.uninstall-btn:hover {
  background: var(--rose-dim, rgba(244, 63, 94, 0.15));
  color: var(--rose);
}
.panel-footer {
  padding: 6px 0 0;
  border-top: 1px solid var(--border-subtle);
}
.import-btn {
  width: 100%;
  padding: 6px 8px;
  border: 1px dashed var(--border-active);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 11px;
  cursor: pointer;
  transition: all var(--transition-fast);
}
.import-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-dim);
}
</style>
