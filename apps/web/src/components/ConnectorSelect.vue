<script setup lang="ts">
import { matchesResourceSearch } from "../utils/resource-search.js";
import { computed, onMounted, ref, watch } from "vue";
import { NPopover, NSwitch } from "naive-ui";
import type { ConnectorDto } from "@pi-web-ui/shared";
import { useI18n } from "../i18n/index.js";
import { useConnectorStore } from "../stores/connector.js";

const props = defineProps<{
  projectId: string;
  disabled?: boolean;
  draft?: boolean;
  inline?: boolean;
  searchQuery?: string;
  modelValue?: string[];
}>();
const emit = defineEmits<{
  (event: "manage"): void;
  (event: "update:modelValue", value: string[]): void;
  (event: "selected", value: ConnectorDto): void;
}>();
const store = useConnectorStore();
const { t } = useI18n();
const show = ref(false);
const available = computed(() => store.connectors.filter((item) => item.scopeType === "user" || item.scopeId === props.projectId));
const selectedIds = computed(() => props.modelValue ?? []);
onMounted(() => store.load(props.projectId));
watch(() => props.projectId, (id) => store.load(id));

function toggleSelection(id: string, enabled: boolean) {
  if (!props.draft) return;
  const next = enabled
    ? [...selectedIds.value, id]
    : selectedIds.value.filter((selectedId) => selectedId !== id);
  emit("update:modelValue", [...new Set(next)]);
}

async function toggleConnector(item: ConnectorDto, enabled: boolean) {
  if (!enabled) {
    if (props.draft) toggleSelection(item.id, false);
    else await store.update(item.id, { enabled: false });
    return;
  }

  if (props.draft) {
    toggleSelection(item.id, true);
    emit("selected", item);
    return;
  }

  const updated = await store.update(item.id, { enabled: true });
  if (updated.enabled) emit("selected", updated);
}
const filteredConnectors = computed(() => available.value.filter((item) => matchesResourceSearch(props.searchQuery, item.name, item.description)));
</script>
<template>
  <NPopover v-if="!props.inline" v-model:show="show" trigger="click" placement="top-start" :width="300">
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
    <div class="picker"><strong>连接器</strong><p v-if="!filteredConnectors.length">{{ t(props.searchQuery?.trim() ? 'chat.resourceSearchEmpty' : 'chat.noConnectors') }}</p><div v-for="item in filteredConnectors" :key="item.id" class="row"><span>{{ item.icon }}</span><span class="name">{{ item.name }}</span><NSwitch size="small" :value="draft ? selectedIds.includes(item.id) : item.enabled" @update:value="toggleConnector(item, $event)" /></div><button class="manage" @click="show = false; emit('manage')">管理全部连接器</button></div>
  </NPopover>
  <div v-else class="picker">
    <strong>连接器</strong>
    <p v-if="!filteredConnectors.length">{{ t(props.searchQuery?.trim() ? 'chat.resourceSearchEmpty' : 'chat.noConnectors') }}</p>
    <div v-for="item in filteredConnectors" :key="item.id" class="row">
      <span>{{ item.icon }}</span>
      <span class="name">{{ item.name }}</span>
      <NSwitch
        size="small"
        :value="draft ? selectedIds.includes(item.id) : item.enabled"
        @update:value="toggleConnector(item, $event)"
      />
    </div>
    <button class="manage" @click="emit('manage')">管理全部连接器</button>
  </div>
</template>
<style scoped>
.tool-btn{display:flex;align-items:center;justify-content:center;width:auto;min-width:72px;height:26px;gap:5px;padding:0 8px;border:1px solid var(--border-default);border-radius:var(--radius-sm);background:transparent;color:var(--text-muted);cursor:pointer;transition:all var(--transition-fast);flex-shrink:0}.tool-btn:hover{color:var(--text-primary)}.tool-btn:disabled{cursor:default;opacity:.55}.tool-btn-label{font-size:11px;white-space:nowrap}.picker{display:grid;gap:10px}.picker>p{color:var(--text-secondary);font-size:12px}.row{display:flex;align-items:center;gap:8px;padding:6px 0}.name{flex:1}.manage{border:0;border-top:1px solid var(--border-color);padding:10px 0 0;background:none;color:var(--primary-color);cursor:pointer;text-align:left}
</style>
