import { defineStore } from "pinia";
import { api } from "../api/client.js";
import type { SessionDto, MessageDto } from "@pi-web-ui/shared";

export const useSessionStore = defineStore("sessions", {
  state: () => ({
    sessions: [] as SessionDto[],
    current: null as SessionDto | null,
    messages: [] as MessageDto[],
  }),
  actions: {
    async loadForProject(projectId: string) {
      this.sessions = await api.listSessions(projectId);
    },
    async create(projectId: string, parentId?: string) {
      const s = await api.createSession(projectId, parentId);
      this.sessions.unshift(s);
      return s;
    },
    async open(id: string) {
      this.current = await api.getSession(id);
      this.messages = await api.listMessages(id);
    },
    async update(id: string, title: string) {
      const updated = await api.updateSession(id, title);
      const idx = this.sessions.findIndex((s) => s.id === id);
      if (idx >= 0) this.sessions.splice(idx, 1, updated);
      if (this.current?.id === id) this.current = updated;
      return updated;
    },
    async remove(id: string) {
      await api.deleteSession(id);
      this.sessions = this.sessions.filter((s) => s.id !== id);
    },
  },
});
