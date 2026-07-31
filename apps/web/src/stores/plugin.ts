import { defineStore } from "pinia";
import type { PluginDto } from "@pi-web-ui/shared";
import { api } from "../api/client.js";

export const usePluginStore = defineStore("plugins", {
  state: () => ({
    plugins: [] as PluginDto[],
    selectedBySession: {} as Record<string, string[]>,
    loading: false,
    updatingSessionId: null as string | null,
    error: null as string | null,
  }),
  getters: {
    enabledPlugins: (state) =>
      state.plugins.filter((plugin) => plugin.enabled && plugin.status !== "unavailable"),
  },
  actions: {
    async loadAll() {
      this.loading = true;
      this.error = null;
      try {
        this.plugins = await api.listPlugins();
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      } finally {
        this.loading = false;
      }
    },
    async loadSession(sessionId: string) {
      this.error = null;
      try {
        const result = await api.getSessionPlugins(sessionId);
        this.selectedBySession[sessionId] = result.selectedPluginIds;
        this.mergePlugins(result.availablePlugins);
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      }
    },
    async setSessionPlugins(sessionId: string, pluginIds: string[]) {
      const previous = this.selectedBySession[sessionId] ?? [];
      this.selectedBySession[sessionId] = pluginIds;
      this.updatingSessionId = sessionId;
      this.error = null;
      try {
        const result = await api.setSessionPlugins(sessionId, pluginIds);
        this.selectedBySession[sessionId] = result.selectedPluginIds;
        this.mergePlugins(result.availablePlugins);
        return result;
      } catch (error) {
        this.selectedBySession[sessionId] = previous;
        this.error = error instanceof Error ? error.message : String(error);
        throw error;
      } finally {
        this.updatingSessionId = null;
      }
    },
    async setEnabled(pluginId: string, enabled: boolean) {
      const updated = await api.updatePlugin(pluginId, { enabled });
      const index = this.plugins.findIndex((plugin) => plugin.id === pluginId);
      if (index >= 0) this.plugins.splice(index, 1, updated);
      else this.plugins.push(updated);
      return updated;
    },
    mergePlugins(items: PluginDto[]) {
      for (const item of items) {
        const index = this.plugins.findIndex((plugin) => plugin.id === item.id);
        if (index >= 0) this.plugins.splice(index, 1, item);
        else this.plugins.push(item);
      }
    },
  },
});
