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
    <template #trigger>
      <button class="tool-btn" :disabled="disabled" title="连接器">
        <svg width="14" height="14" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <path d="m7.1 10.9-1.3 1.3a2.5 2.5 0 0 1-3.5-3.5l2-2a2.5 2.5 0 0 1 3.5 0" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" />
          <path d="m10.9 7.1 1.3-1.3a2.5 2.5 0 0 1 3.5 3.5l-2 2a2.5 2.5 0 0 1-3.5 0" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" />
          <path d="m6.5 11.5 5-5" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" />
        </svg>
        <span class="tool-btn-label">连接器</span>
      </button>
    </template>
    <div class="picker"><strong>连接器</strong><p v-if="!available.length">暂无连接器</p><div v-for="item in available" :key="item.id" class="row"><span>{{ item.icon }}</span><span class="name">{{ item.name }}</span><NSwitch size="small" :value="item.enabled" @update:value="store.update(item.id, { enabled: $event })" /></div><button class="manage" @click="show = false; emit('manage')">管理全部连接器</button></div>
  </NPopover>
</template>
<style scoped>
.tool-btn{display:flex;align-items:center;justify-content:center;width:auto;min-width:72px;height:26px;gap:5px;padding:0 8px;border:1px solid var(--border-default);border-radius:var(--radius-sm);background:transparent;color:var(--text-muted);cursor:pointer;transition:all var(--transition-fast);flex-shrink:0}.tool-btn:hover{color:var(--text-primary)}.tool-btn:disabled{cursor:default;opacity:.55}.tool-btn-label{font-size:11px;white-space:nowrap}.picker{display:grid;gap:10px}.picker>p{color:var(--text-secondary);font-size:12px}.row{display:flex;align-items:center;gap:8px;padding:6px 0}.name{flex:1}.manage{border:0;border-top:1px solid var(--border-color);padding:10px 0 0;background:none;color:var(--primary-color);cursor:pointer;text-align:left}
</style>
