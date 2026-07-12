<script setup lang="ts">
// Native <img> preview. The URL points at the server's /raw endpoint which
// sets the correct Content-Type per extension; browsers handle the rest.
defineProps<{ url: string }>();
</script>

<template>
  <div class="image-preview">
    <img :src="url" alt="" class="image" />
  </div>
</template>

<style scoped>
.image-preview {
  flex: 1;
  overflow: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: var(--bg-void);
}
.image {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: var(--radius-sm);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
}
</style>
