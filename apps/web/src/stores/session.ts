import { defineStore } from "pinia";
import { api } from "../api/client.js";
import type { SessionDto, SessionAuthorizationMode, MessageDto } from "@pi-web-ui/shared";

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
    async setExpert(id: string, expertId: string | null) {
      const updated = await api.updateSessionExpert(id, expertId);
      const idx = this.sessions.findIndex((s) => s.id === id);
      if (idx >= 0) this.sessions.splice(idx, 1, updated);
      if (this.current?.id === id) this.current = updated;
      return updated;
    },
    async setAuthorizationMode(id: string, authorizationMode: SessionAuthorizationMode) {
      const target = this.sessions.find((session) => session.id === id)
        ?? (this.current?.id === id ? this.current : null);
      const projectId = target?.projectId;
      const previousSessions = projectId
        ? this.sessions.filter((session) => session.projectId === projectId)
        : [];
      const previousCurrent = projectId && this.current?.projectId === projectId
        ? this.current
        : null;
      if (projectId) this.applyProjectAuthorizationMode(projectId, authorizationMode);
      else if (target) this.applySession({ ...target, authorizationMode });
      try {
        const updated = await api.updateSessionAuthorizationMode(id, authorizationMode);
        if (projectId) this.applyProjectAuthorizationMode(projectId, updated.authorizationMode);
        else this.applySession(updated);
        return updated;
      } catch (error) {
        if (projectId) {
          const previousById = new Map(previousSessions.map((session) => [session.id, session]));
          this.sessions = this.sessions.map((session) => previousById.get(session.id) ?? session);
          if (previousCurrent) this.current = previousCurrent;
        } else if (target) {
          const current = this.sessions.find((session) => session.id === id)
            ?? (this.current?.id === id ? this.current : null);
          if (current?.authorizationMode === authorizationMode) this.applySession(target);
        }
        throw error;
      }
    },
    async remove(id: string) {
      await api.deleteSession(id);
      this.sessions = this.sessions.filter((s) => s.id !== id);
    },
    applySession(updated: SessionDto) {
      const idx = this.sessions.findIndex((session) => session.id === updated.id);
      if (idx >= 0) this.sessions.splice(idx, 1, updated);
      if (this.current?.id === updated.id) this.current = updated;
    },
    applyProjectAuthorizationMode(projectId: string, authorizationMode: SessionAuthorizationMode) {
      this.sessions = this.sessions.map((session) => session.projectId === projectId
        ? { ...session, authorizationMode }
        : session);
      if (this.current?.projectId === projectId) {
        this.current = { ...this.current, authorizationMode };
      }
    },
    applyUnreadCount(id: string, unreadCount: number) {
      const session = this.sessions.find((candidate) => candidate.id === id);
      if (session) session.unreadCount = unreadCount;
      if (this.current?.id === id) this.current.unreadCount = unreadCount;
    },
    async markRead(id: string, messageId?: string) {
      const updated = await api.markSessionRead(id, messageId);
      this.applySession(updated);
      return updated;
    },
  },
});
