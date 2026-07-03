<script setup lang="ts">
import { onMounted } from "vue";
import { NConfigProvider, NMessageProvider, NDialogProvider } from "naive-ui";
import { useConnectionStore } from "./stores/connection.js";
import { useAgentStore } from "./stores/agent.js";
import StatusBanner from "./components/StatusBanner.vue";

const connection = useConnectionStore();
const agent = useAgentStore();
onMounted(() => { connection.init(); agent.init(); });
</script>

<template>
  <NConfigProvider>
    <NDialogProvider>
      <NMessageProvider>
        <StatusBanner />
        <RouterView />
      </NMessageProvider>
    </NDialogProvider>
  </NConfigProvider>
</template>
