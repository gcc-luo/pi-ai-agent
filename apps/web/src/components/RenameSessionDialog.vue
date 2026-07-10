<script setup lang="ts">
import { ref, watch, nextTick } from "vue";
import { NModal, NInput } from "naive-ui";
import { useI18n } from "../i18n/index.js";
import type { SessionDto } from "@pi-web-ui/shared";

const props = defineProps<{ show: boolean; session: SessionDto | null }>();
const emit = defineEmits<{
  (e: "close"): void;
  (e: "rename", id: string, title: string): void;
}>();

const { t } = useI18n();
const title = ref("");
const inputRef = ref<InstanceType<typeof NInput> | null>(null);

watch(
  () => props.show,
  async (visible) => {
    if (!visible) return;
    title.value = props.session?.title ?? "";
    await nextTick();
    const el = (inputRef.value as any)?.$el as HTMLElement | undefined;
    const input = el?.querySelector("input") as HTMLInputElement | null;
    input?.focus();
    input?.select();
  },
  { immediate: true },
);

function handleSave() {
  const trimmed = title.value.trim();
  if (!trimmed || !props.session) return;
  emit("rename", props.session.id, trimmed);
  emit("close");
}
</script>

<template>
  <NModal :show="show" @update:show="(v: boolean) => { if (!v) emit('close'); }">
    <div class="dialog" @click.stop>
      <div class="dialog-header">
        <h3 class="dialog-title">{{ t('renameSession.title') }}</h3>
        <button class="dialog-close" @click="emit('close')">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
          </svg>
        </button>
      </div>

      <div class="name-row">
        <label class="name-label">{{ t('renameSession.label') }}</label>
        <NInput
          ref="inputRef"
          v-model:value="title"
          size="small"
          :placeholder="t('renameSession.placeholder')"
          @keydown.enter="handleSave"
        />
      </div>

      <div class="dialog-actions">
        <button class="btn-cancel" @click="emit('close')">{{ t('renameSession.cancel') }}</button>
        <button
          class="btn-save"
          data-test="save"
          :disabled="!title.trim()"
          @click="handleSave"
        >
          {{ t('renameSession.save') }}
        </button>
      </div>
    </div>
  </NModal>
</template>

<style scoped>
.dialog {
  width: 420px;
  display: flex;
  flex-direction: column;
  background: var(--bg-deep);
  border: 1px solid var(--border-default);
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}
.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 12px;
}
.dialog-title {
  font-family: var(--font-mono);
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}
.dialog-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
}
.dialog-close:hover { background: var(--bg-hover); color: var(--text-primary); }
.name-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 20px 16px;
}
.name-label {
  flex-shrink: 0;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  color: var(--text-faint);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 0 20px 16px;
}
.btn-cancel, .btn-save {
  padding: 7px 18px;
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--transition-fast);
}
.btn-cancel {
  border: 1px solid var(--border-default);
  background: transparent;
  color: var(--text-muted);
}
.btn-cancel:hover { border-color: var(--text-muted); color: var(--text-primary); }
.btn-save {
  border: none;
  background: var(--accent);
  color: var(--bg-void);
}
.btn-save:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-save:not(:disabled):hover { filter: brightness(1.1); }
</style>
