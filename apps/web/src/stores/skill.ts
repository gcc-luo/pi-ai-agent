import { defineStore } from "pinia";
import { api } from "../api/client.js";
import type { SkillDto } from "@pi-web-ui/shared";

export const useSkillStore = defineStore("skills", {
  state: () => ({
    skills: [] as SkillDto[],
    loading: false,
  }),
  actions: {
    async loadAll() {
      this.loading = true;
      try { this.skills = await api.listSkills(); }
      finally { this.loading = false; }
    },
    async importSkill(input: { name: string; description: string; body: string }) {
      const dto = await api.importSkill(input);
      const idx = this.skills.findIndex((s) => s.name === dto.name);
      if (idx >= 0) this.skills.splice(idx, 1, dto);
      else this.skills.push(dto);
      this.skills.sort((a, b) => a.name.localeCompare(b.name));
      return dto;
    },
    async importSkillZip(file: File) {
      const result = await api.importSkillZip(file);
      // Refresh from server so names/descriptions match what's on disk.
      await this.loadAll();
      return result;
    },
    async remove(name: string) {
      await api.deleteSkill(name);
      this.skills = this.skills.filter((s) => s.name !== name);
    },
  },
});
