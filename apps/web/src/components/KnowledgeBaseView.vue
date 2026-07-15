<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useKbStore } from "../stores/kb.js";
import KbListPage from "./KbListPage.vue";
import KbDetailPage from "./KbDetailPage.vue";

const kbStore = useKbStore();
const selectedKbId = ref<string | null>(null);

onMounted(() => {
  kbStore.loadAll();
});
</script>

<template>
  <main class="kb-view">
    <KbListPage
      v-if="selectedKbId === null"
      @select="selectedKbId = $event"
    />
    <KbDetailPage
      v-else
      :kb-id="selectedKbId"
      @back="selectedKbId = null"
      @deleted="selectedKbId = null"
    />
  </main>
</template>

<style scoped>
.kb-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-void);
}
</style>
