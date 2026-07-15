import { defineStore } from "pinia";
import { api } from "../api/client.js";
import type { KbDto } from "@pi-web-ui/shared";

export const useKbStore = defineStore("kb", {
  state: () => ({
    knowledgeBases: [] as KbDto[],
    loading: false,
    current: null as KbDto | null,
  }),
  actions: {
    async loadAll() {
      this.loading = true;
      try {
        this.knowledgeBases = await api.listKnowledgeBases();
      } finally {
        this.loading = false;
      }
    },
    async create(name: string, description?: string) {
      const kb = await api.createKnowledgeBase(name, description);
      this.knowledgeBases.unshift(kb);
      return kb;
    },
    async update(id: string, patch: { name?: string; description?: string | null; enabled?: boolean }) {
      const kb = await api.updateKnowledgeBase(id, patch);
      const idx = this.knowledgeBases.findIndex((k) => k.id === id);
      if (idx >= 0) this.knowledgeBases[idx] = kb;
      if (this.current?.id === id) this.current = kb;
      return kb;
    },
    async remove(id: string) {
      await api.deleteKnowledgeBase(id);
      this.knowledgeBases = this.knowledgeBases.filter((k) => k.id !== id);
      if (this.current?.id === id) this.current = null;
    },
    setCurrent(kb: KbDto | null) {
      this.current = kb;
    },
  },
});
