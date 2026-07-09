<script setup lang="ts">
import { NModal } from "naive-ui";

const props = defineProps<{
  show: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
}>();
const emit = defineEmits<{
  (e: "close"): void;
  (e: "confirm"): void;
}>();

function handleConfirm() {
  emit("confirm");
  emit("close");
}
</script>

<template>
  <NModal :show="show" @update:show="(v: boolean) => { if (!v) emit('close'); }">
    <div class="dialog" @click.stop>
      <div class="dialog-header">
        <h3 class="dialog-title">{{ title }}</h3>
      </div>
      <div class="dialog-body">{{ message }}</div>
      <div class="dialog-actions">
        <button class="btn-cancel" data-test="cancel" @click="emit('close')">{{ cancelLabel }}</button>
        <button
          class="btn-confirm"
          :class="{ danger: props.danger }"
          data-test="confirm"
          @click="handleConfirm"
        >
          {{ confirmLabel }}
        </button>
      </div>
    </div>
  </NModal>
</template>

<style scoped>
.dialog {
  width: 420px;
  background: var(--bg-deep);
  border: 1px solid var(--border-default);
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}
.dialog-header { padding: 16px 20px 8px; }
.dialog-title {
  font-family: var(--font-mono);
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}
.dialog-body {
  padding: 0 20px 16px;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
}
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 0 20px 16px;
}
.btn-cancel, .btn-confirm {
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
.btn-confirm {
  border: none;
  background: var(--accent);
  color: var(--bg-void);
}
.btn-confirm.danger { background: var(--rose); }
.btn-confirm:hover { filter: brightness(1.1); }
</style>
