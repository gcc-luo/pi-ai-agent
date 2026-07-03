<script setup lang="ts">
import { ref, watch } from "vue";
import { NSpin } from "naive-ui";
import { api } from "../api/client.js";

const props = defineProps<{ projectId: string; path: string | null }>();
const content = ref<string>("");
const loading = ref(false);
const error = ref<string | null>(null);

watch(
  () => [props.projectId, props.path],
  async () => {
    if (!props.path) { content.value = ""; return; }
    loading.value = true; error.value = null;
    try {
      const r = await api.readFile(props.projectId, props.path);
      content.value = r.content;
    } catch (e: any) {
      error.value = e.message;
    } finally {
      loading.value = false;
    }
  },
  { immediate: true },
);
</script>

<template>
  <div class="file-viewer">
    <NSpin v-if="loading" />
    <pre v-else-if="!error" class="content">{{ content }}</pre>
    <div v-else class="error">{{ error }}</div>
  </div>
</template>

<style scoped>
.file-viewer { padding: 12px; height: 100%; overflow: auto; }
.content { background: #fafafa; padding: 12px; border-radius: 6px; font-family: ui-monospace, monospace; font-size: 13px; }
.error { color: #d03050; }
</style>
