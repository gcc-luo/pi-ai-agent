<script setup lang="ts">
// Native <video> with controls; the /raw endpoint honours Range requests so
// seeking works without buffering the whole file.
defineProps<{ url: string }>();
</script>

<template>
  <div class="video-preview">
    <video :src="url" controls preload="metadata" class="video" />
  </div>
</template>

<style scoped>
.video-preview {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: var(--bg-void);
}
.video {
  max-width: 100%;
  max-height: 100%;
  border-radius: var(--radius-sm);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}
</style>
