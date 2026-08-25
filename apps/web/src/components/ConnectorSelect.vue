<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { NPopover, NSwitch } from "naive-ui";
import { useConnectorStore } from "../stores/connector.js";

const props = defineProps<{ projectId: string; disabled?: boolean }>();
const emit = defineEmits<{ (event: "manage"): void }>();
const store = useConnectorStore();
const show = ref(false);
const available = computed(() => store.connectors.filter((item) => item.scopeType === "user" || item.scopeId === props.projectId));
onMounted(() => store.load(props.projectId));
watch(() => props.projectId, (id) => store.load(id));
</script>
<template>
  <NPopover v-model:show="show" trigger="click" placement="top-start" :width="300">
    <template #trigger><button class="tool-btn" :disabled="disabled" title="连接器"><span>🔌</span><span class="tool-btn-label">连接器</span></button></template>
    <div class="picker"><strong>连接器</strong><p v-if="!available.length">暂无连接器</p><div v-for="item in available" :key="item.id" class="row"><span>{{ item.icon }}</span><span class="name">{{ item.name }}</span><NSwitch size="small" :value="item.enabled" @update:value="store.update(item.id, { enabled: $event })" /></div><button class="manage" @click="show = false; emit('manage')">管理全部连接器</button></div>
  </NPopover>
</template>
<style scoped>
.tool-btn{display:flex;align-items:center;gap:5px;border:0;background:transparent;color:var(--text-secondary);cursor:pointer}.tool-btn:hover{color:var(--primary-color)}.picker{display:grid;gap:10px}.picker>p{color:var(--text-secondary);font-size:12px}.row{display:flex;align-items:center;gap:8px;padding:6px 0}.name{flex:1}.manage{border:0;border-top:1px solid var(--border-color);padding:10px 0 0;background:none;color:var(--primary-color);cursor:pointer;text-align:left}
</style>
