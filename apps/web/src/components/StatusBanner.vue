<script setup lang="ts">
import { computed } from "vue";
import { NAlert } from "naive-ui";
import { useConnectionStore } from "../stores/connection.js";

const connection = useConnectionStore();
const message = computed(() => {
  if (connection.status === "connected") return null;
  if (connection.status === "connecting") return "Connecting...";
  return "Disconnected — retrying...";
});
const type = computed(() => (connection.status === "connecting" ? "info" : "warning"));
</script>

<template>
  <NAlert v-if="message" :type="type" closable :show-icon="false" class="banner">
    {{ message }}
  </NAlert>
</template>

<style scoped>
.banner { border-radius: 0; }
</style>
