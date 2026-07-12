<script setup lang="ts">
// Browsers render PDFs natively inside an <iframe>. Chromium/Firefox/Safari
// all ship a built-in viewer with pagination, search, and zoom — we just
// point it at the raw stream.
defineProps<{ url: string }>();
</script>

<template>
  <iframe :src="url" class="pdf-frame" title="PDF preview" />
</template>

<style scoped>
.pdf-frame {
  flex: 1;
  border: none;
  background: var(--bg-void);
  width: 100%;
  min-height: 0;
}
</style>
