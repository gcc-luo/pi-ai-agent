<script setup lang="ts">
import { onMounted, ref } from "vue";
import { NButton, NInput, NCard, NSpace, NSpin, NEmpty, useMessage } from "naive-ui";
import { useProjectStore } from "../stores/project.js";

const store = useProjectStore();
const message = useMessage();
const newName = ref("");

onMounted(() => store.loadAll());

async function create() {
  if (!newName.value.trim()) return;
  const p = await store.create(newName.value);
  message.success(`Created ${p.name}`);
  newName.value = "";
}
</script>

<template>
  <div class="home">
    <h1>Projects</h1>
    <NSpace>
      <NInput v-model:value="newName" placeholder="New project name" @keydown.enter="create" />
      <NButton type="primary" @click="create">Create</NButton>
    </NSpace>
    <NSpin v-if="store.loading" />
    <NEmpty v-else-if="!store.projects.length" description="No projects yet" />
    <div v-else class="grid">
      <NCard v-for="p in store.projects" :key="p.id" :title="p.name">
        <RouterLink :to="`/projects/${p.id}`">Open</RouterLink>
      </NCard>
    </div>
  </div>
</template>

<style scoped>
.home { padding: 24px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; margin-top: 16px; }
</style>
