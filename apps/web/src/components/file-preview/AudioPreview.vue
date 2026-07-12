<script setup lang="ts">
defineProps<{ url: string }>();
</script>

<template>
  <div class="audio-preview">
    <svg class="icon" width="48" height="48" viewBox="0 0 48 48" fill="none">
      <circle cx="24" cy="24" r="22" stroke="currentColor" stroke-width="1.5" opacity="0.3" />
      <path d="M18 28V18a4 4 0 014-4h4a4 4 0 014 4v10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
      <rect x="14" y="26" width="8" height="14" rx="2" stroke="currentColor" stroke-width="1.6" />
      <rect x="26" y="26" width="8" height="14" rx="2" stroke="currentColor" stroke-width="1.6" />
    </svg>
    <audio :src="url" controls preload="metadata" class="audio" />
  </div>
</template>

<style scoped>
.audio-preview {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 18px;
  padding: 24px;
  background: var(--bg-void);
  color: var(--text-muted);
}
.audio {
  width: min(420px, 100%);
}
</style>
