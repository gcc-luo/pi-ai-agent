import { defineStore } from "pinia";
import { api } from "../api/client.js";
import type { TrashItemDto } from "@pi-web-ui/shared";

export const useTrashStore = defineStore("trash", {
  state: () => ({
    items: [] as TrashItemDto[],
    loading: false,
  }),
  getters: {
    count: (state) => state.items.length,
    projects: (state) => state.items.filter(i => i.kind === "project"),
    sessions: (state) => state.items.filter(i => i.kind === "session"),
  },
  actions: {
    async load() {
      this.loading = true;
      try {
        this.items = await api.listTrash();
      } finally {
        this.loading = false;
      }
    },
    async restore(kind: "project" | "session", id: string) {
      await api.restoreItem(kind, id);
      this.items = this.items.filter(i => !(i.kind === kind && i.id === id));
    },
    async destroy(kind: "project" | "session", id: string) {
      await api.destroyItem(kind, id);
      this.items = kind === "project"
        ? this.items.filter((item) => item.projectId !== id)
        : this.items.filter((item) => !(item.kind === "session" && item.id === id));
    },
    async emptyAll() {
      await api.emptyTrash();
      this.items = [];
    },
  },
});
