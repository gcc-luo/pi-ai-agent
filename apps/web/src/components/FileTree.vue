<script setup lang="ts">
import { ref, watch } from "vue";
import { NTree } from "naive-ui";
import { api } from "../api/client.js";
import type { TreeOption } from "naive-ui";
import type { FileNodeDto } from "@pi-web-ui/shared";

const props = defineProps<{ projectId: string }>();
const emit = defineEmits<{ (e: "select", path: string): void }>();

const treeData = ref<TreeOption[]>([]);
const selectedKeys = ref<string[]>([]);

function toTree(nodes: FileNodeDto[]): TreeOption[] {
  return nodes.map((n) => ({
    key: n.path,
    label: n.name,
    isLeaf: n.type === "file",
    prefix: () =>
      h("span", { class: n.type === "directory" ? "tree-icon dir" : "tree-icon file" }, [
        n.type === "directory" ? dirIcon : fileIcon,
      ]),
    children: n.children ? toTree(n.children) : undefined,
  }));
}

import { h } from "vue";

const dirIcon = h("svg", { width: 14, height: 14, viewBox: "0 0 14 14", fill: "none" }, [
  h("path", {
    d: "M1.5 3a1 1 0 011-1h3.586a1 1 0 01.707.293l1.414 1.414a1 1 0 00.707.293h3.586a1 1 0 011 1V11a1 1 0 01-1 1h-9a1 1 0 01-1-1V3z",
    stroke: "currentColor",
    "stroke-width": "1.2",
  }),
]);

const fileIcon = h("svg", { width: 14, height: 14, viewBox: "0 0 14 14", fill: "none" }, [
  h("path", {
    d: "M4 1.5h4.586a1 1 0 01.707.293l2.414 2.414a1 1 0 01.293.707V12a1 1 0 01-1 1H4a1 1 0 01-1-1V2.5a1 1 0 011-1z",
    stroke: "currentColor",
    "stroke-width": "1.2",
  }),
  h("path", {
    d: "M8.5 1.5v3h3",
    stroke: "currentColor",
    "stroke-width": "1.2",
    "stroke-linejoin": "round",
  }),
]);

async function load() {
  const list = await api.listFiles(props.projectId, "/");
  treeData.value = toTree(list);
}

watch(() => props.projectId, load, { immediate: true });

function handleSelect(keys: string[]) {
  selectedKeys.value = keys;
  if (keys[0]) emit("select", keys[0]);
}
</script>

<template>
  <div class="file-tree">
    <NTree
      :data="treeData"
      :selected-keys="selectedKeys"
      block-line
      selectable
      :indent="16"
      @update:selected-keys="handleSelect"
    />
  </div>
</template>

<style scoped>
.file-tree {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 4px 8px 12px;
}

.file-tree :deep(.n-tree) {
  --n-node-color-hover: var(--bg-hover);
  --n-node-color-active: var(--accent-dim);
  --n-text-color: var(--text-secondary);
  --n-font-size: 12px;
}

.file-tree :deep(.n-tree-node-content) {
  font-family: var(--font-mono);
  font-size: 12px;
  padding: 2px 0;
}

.file-tree :deep(.n-tree-node--selected .n-tree-node-content) {
  color: var(--accent);
}

.file-tree :deep(.n-tree-node--selected) {
  position: relative;
}

.file-tree :deep(.n-tree-node--selected::before) {
  content: "";
  position: absolute;
  left: 0;
  top: 2px;
  bottom: 2px;
  width: 2px;
  background: var(--accent);
  border-radius: 1px;
}

.file-tree :deep(.n-tree-node-switcher) {
  color: var(--text-faint);
}

.tree-icon {
  display: inline-flex;
  align-items: center;
  margin-right: 4px;
}

.tree-icon.dir {
  color: var(--amber);
  opacity: 0.7;
}

.tree-icon.file {
  color: var(--text-muted);
}
</style>
