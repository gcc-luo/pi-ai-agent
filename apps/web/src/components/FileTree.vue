<script setup lang="ts">
import { ref, watch } from "vue";
import { NTree } from "naive-ui";
import { api } from "../api/client.js";
import type { FileNodeDto } from "@pi-web-ui/shared";

const props = defineProps<{ projectId: string }>();
const emit = defineEmits<{ (e: "select", path: string): void }>();

const treeData = ref<any[]>([]);

function toTree(nodes: FileNodeDto[]): any[] {
  return nodes.map((n) => ({
    key: n.path,
    label: n.name,
    isLeaf: n.type === "file",
    children: n.children ? toTree(n.children) : undefined,
  }));
}

async function load() {
  const list = await api.listFiles(props.projectId, "/");
  treeData.value = toTree(list);
}

watch(() => props.projectId, load, { immediate: true });
</script>

<template>
  <NTree :data="treeData" block-line @update:selected-keys="(keys: string[]) => keys[0] && emit('select', keys[0])" />
</template>
