import { defineStore } from "pinia";
import { api } from "../api/client.js";
import type { ExpertDto, ExpertCategory, SessionDto } from "@pi-web-ui/shared";

export const useExpertStore = defineStore("experts", {
  state: () => ({
    experts: [] as ExpertDto[],
    loading: false,
    activeCategory: null as ExpertCategory | null,
    searchQuery: "",
  }),
  getters: {
    filteredExperts(state): ExpertDto[] {
      let list = state.experts;
      if (state.activeCategory) {
        list = list.filter((e) => e.category === state.activeCategory);
      }
      const q = state.searchQuery.trim().toLowerCase();
      if (q) {
        list = list.filter(
          (e) =>
            e.name.toLowerCase().includes(q) ||
            e.description.toLowerCase().includes(q) ||
            e.tags.some((t) => t.toLowerCase().includes(q)),
        );
      }
      return list;
    },
    presetExperts(): ExpertDto[] {
      return this.experts.filter((e: ExpertDto) => e.isPreset);
    },
    customExperts(): ExpertDto[] {
      return this.experts.filter((e: ExpertDto) => !e.isPreset);
    },
  },
  actions: {
    async loadAll() {
      this.loading = true;
      try {
        this.experts = await api.listExperts();
      } finally {
        this.loading = false;
      }
    },
    async create(input: {
      name: string; icon?: string; category: ExpertCategory;
      description: string; systemPrompt: string; tags?: string[];
    }) {
      const expert = await api.createExpert(input);
      this.experts.unshift(expert);
      return expert;
    },
    async update(id: string, patch: Partial<{
      name: string; icon: string; category: ExpertCategory;
      description: string; systemPrompt: string; tags: string[]; sortOrder: number;
    }>) {
      const updated = await api.updateExpert(id, patch);
      const idx = this.experts.findIndex((e) => e.id === id);
      if (idx >= 0) this.experts.splice(idx, 1, updated);
      return updated;
    },
    async remove(id: string) {
      await api.deleteExpert(id);
      this.experts = this.experts.filter((e) => e.id !== id);
    },
    async summon(expertId: string, projectId: string): Promise<SessionDto> {
      return api.summonExpert(expertId, projectId);
    },
    setCategory(category: ExpertCategory | null) {
      this.activeCategory = category;
    },
    setSearch(query: string) {
      this.searchQuery = query;
    },
  },
});
