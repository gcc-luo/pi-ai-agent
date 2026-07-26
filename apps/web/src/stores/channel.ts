import { defineStore } from "pinia";
import { ref } from "vue";
import { api } from "../api/client.js";
import type { ChannelDescriptor, ChannelConfigDto, ChannelType, ChannelTestResult } from "@pi-web-ui/shared";

export const useChannelStore = defineStore("channels", () => {
  const descriptors = ref<ChannelDescriptor[]>([]);
  const configs = ref<ChannelConfigDto[]>([]);
  const loading = ref(false);

  async function loadAll() {
    loading.value = true;
    try {
      const [d, c] = await Promise.all([api.listChannelDescriptors(), api.listChannelConfigs()]);
      descriptors.value = d;
      configs.value = c;
    } finally {
      loading.value = false;
    }
  }

  function configFor(type: ChannelType): ChannelConfigDto | null {
    return configs.value.find((c) => c.type === type) ?? null;
  }

  async function create(data: { type: ChannelType; name: string; config: Record<string, unknown> }) {
    const created = await api.createChannelConfig(data);
    configs.value = [...configs.value, created];
    return created;
  }

  async function update(id: string, patch: { name?: string; enabled?: boolean; config?: Record<string, unknown> }) {
    const updated = await api.updateChannelConfig(id, patch);
    configs.value = configs.value.map((c) => (c.id === id ? updated : c));
    return updated;
  }

  async function remove(id: string) {
    await api.deleteChannelConfig(id);
    configs.value = configs.value.filter((c) => c.id !== id);
  }

  async function test(id: string, text?: string): Promise<ChannelTestResult> {
    return api.testChannelConfig(id, { text });
  }

  return { descriptors, configs, loading, loadAll, configFor, create, update, remove, test };
});
