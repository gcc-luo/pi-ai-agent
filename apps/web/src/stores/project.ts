import { defineStore } from "pinia";
import { api } from "../api/client.js";
import type { ProjectDto } from "@pi-web-ui/shared";

export const useProjectStore = defineStore("projects", {
  state: () => ({
    projects: [] as ProjectDto[],
    current: null as ProjectDto | null,
    loading: false,
  }),
  actions: {
    async loadAll() {
      this.loading = true;
      try { this.projects = await api.listProjects(); }
      finally { this.loading = false; }
    },
    async loadOne(id: string) {
      this.current = await api.getProject(id);
    },
    async create(name: string, workdir: string, description?: string) {
      const p = await api.createProject(name, workdir, description);
      this.projects.unshift(p);
      return p;
    },
    async update(id: string, name: string) {
      const updated = await api.updateProject(id, name);
      const idx = this.projects.findIndex((p) => p.id === id);
      if (idx >= 0) this.projects.splice(idx, 1, updated);
      if (this.current?.id === id) this.current = updated;
      return updated;
    },
    async remove(id: string) {
      await api.deleteProject(id);
      this.projects = this.projects.filter((p) => p.id !== id);
    },
  },
});
