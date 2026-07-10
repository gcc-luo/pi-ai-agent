<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useSkillStore } from "../stores/skill.js";
import ConfirmDialog from "./ConfirmDialog.vue";
import { useI18n } from "../i18n/index.js";

const emit = defineEmits<{
  (e: "select", name: string): void;
  (e: "import"): void;
}>();

const skillStore = useSkillStore();
const { t } = useI18n();

const open = ref(false);
const uninstallTarget = ref<string | null>(null);

onMounted(() => { skillStore.loadAll(); });

function toggle() {
  open.value = !open.value;
  if (open.value) skillStore.loadAll();
}

function selectSkill(name: string) {
  emit("select", name);
  open.value = false;
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
    <button class="toggle" data-test="skill-toggle" @click="toggle" :title="t('skill.dropdown')">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M2 4h10M4 7h6M6 10h2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
      </svg>
      <span class="toggle-label">{{ t('skill.dropdown') }}</span>
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" :class="{ flipped: open }">
        <path d="M2 3l3 3 3-3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>

    <div v-if="open" class="panel">
      <div v-if="!skillStore.skills.length" class="empty">{{ t('skill.empty') }}</div>
      <div
        v-for="s in skillStore.skills"
        v-else
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
      <div class="panel-footer">
        <button class="import-btn" data-test="skill-import-btn" @click="emit('import'); open = false">
          + {{ t('skill.import') }}
        </button>
      </div>
    </div>

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
  position: relative;
  display: flex;
  align-items: flex-end;
}
.toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 10px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  color: var(--text-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
  flex-shrink: 0;
}
.toggle:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.toggle-label {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.panel {
  position: absolute;
  bottom: calc(100% + 6px);
  right: 0;
  width: 320px;
  max-height: 360px;
  overflow-y: auto;
  background: var(--bg-deep);
  border: 1px solid var(--border-default);
  border-radius: 10px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
  z-index: 10;
}
.empty {
  padding: 16px 12px;
  font-size: 12px;
  color: var(--text-faint);
  text-align: center;
  font-style: italic;
}
.skill-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  cursor: pointer;
  transition: background var(--transition-fast);
  border-bottom: 1px solid var(--border-subtle);
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
  padding: 6px 10px;
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
.flipped { transform: rotate(180deg); }
</style>
