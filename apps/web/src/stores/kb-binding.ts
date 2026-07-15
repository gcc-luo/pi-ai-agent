import { defineStore } from "pinia";
import { api } from "../api/client.js";
import type { KbBindingDto } from "@pi-web-ui/shared";

export const useKbBindingStore = defineStore("kb-binding", {
  state: () => ({
    bindings: {} as Record<string, KbBindingDto[]>,
  }),
  actions: {
    async load(sessionId: string) {
      this.bindings[sessionId] = await api.getKbBindings(sessionId);
    },
    async save(sessionId: string, bindings: { kbId: string; fileFilter?: string[] | null }[]) {
      const result = await api.setKbBindings(sessionId, bindings);
      this.bindings[sessionId] = result;
      return result;
    },
    getForSession(sessionId: string): KbBindingDto[] {
      return this.bindings[sessionId] ?? [];
    },
  },
});
