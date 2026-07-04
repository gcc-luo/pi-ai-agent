import { defineStore } from "pinia";
import { wsClient } from "../api/ws.js";
import { api, type ModelOption } from "../api/client.js";
import type { ModelDto, ServerEvent } from "@pi-web-ui/shared";

interface StreamMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "streaming" | "complete" | "error";
}

export const useAgentStore = defineStore("agent", {
  state: () => ({
    streams: {} as Record<string, StreamMessage[]>,
    errors: [] as { sessionId?: string; code: string; message: string }[],
    currentModel: null as string | null,
    currentProvider: null as string | null,
    models: [] as ModelOption[],
    modelDtos: [] as ModelDto[],
  }),
  getters: {
    messagesFor: (state) => (sessionId: string): StreamMessage[] => state.streams[sessionId] ?? [],
    currentModelLabel: (state) => {
      const m = state.models.find((m) => m.id === state.currentModel);
      return m?.label ?? state.currentModel ?? "";
    },
  },
  actions: {
    init() {
      wsClient.onEvent((e) => this.handle(e));
      this.loadConfig();
    },
    async loadConfig() {
      try {
        const cfg = await api.getConfig();
        this.currentModel = cfg.model;
        this.currentProvider = cfg.provider;
        this.models = cfg.models;
      } catch {}
      try {
        this.modelDtos = await api.listModels();
      } catch {}
    },
    async switchModel(model: string) {
      this.currentModel = model;
      const m = this.models.find((m) => m.id === model);
      if (m) this.currentProvider = m.provider;
      try {
        await api.updateConfig(model);
        this.modelDtos = await api.listModels();
      } catch {}
    },
    async createModel(data: { id: string; label: string; provider: string; apiBaseUrl?: string; apiKey?: string; isDefault?: boolean }) {
      const m = await api.createModel(data);
      this.modelDtos = [...this.modelDtos, m];
      await this.loadConfig();
      return m;
    },
    async updateModel(id: string, data: { label?: string; provider?: string; apiBaseUrl?: string | null; apiKey?: string | null; isDefault?: boolean }) {
      const m = await api.updateModel(id, data);
      const idx = this.modelDtos.findIndex((x) => x.id === id);
      if (idx >= 0) this.modelDtos[idx] = m;
      await this.loadConfig();
      return m;
    },
    async deleteModel(id: string) {
      await api.deleteModel(id);
      this.modelDtos = this.modelDtos.filter((x) => x.id !== id);
      await this.loadConfig();
    },
    send(sessionId: string, content: string) {
      this.appendUser(sessionId, content);
      wsClient.send({ type: "send", sessionId, content });
    },
    interrupt(sessionId: string) {
      wsClient.send({ type: "interrupt", sessionId });
    },
    appendUser(sessionId: string, content: string) {
      const msg: StreamMessage = { id: `u-${Date.now()}`, role: "user", content, status: "complete" };
      this.streams[sessionId] = [...(this.streams[sessionId] ?? []), msg];
    },
    handle(e: ServerEvent) {
      if (e.type === "error") {
        this.errors = [...this.errors, { sessionId: e.sessionId, code: e.code, message: e.message }];
        return;
      }
      if (!("sessionId" in e) || !e.sessionId) return;
      const sid = e.sessionId;
      const list = this.streams[sid] ?? [];
      if (e.type === "message_start") {
        this.streams[sid] = [...list, { id: e.messageId, role: e.role, content: "", status: "streaming" }];
      } else if (e.type === "message_delta") {
        this.streams[sid] = list.map((m) => m.id === e.messageId ? { ...m, content: m.content + e.delta } : m);
      } else if (e.type === "message_end") {
        this.streams[sid] = list.map((m) => m.id === e.messageId ? { ...m, content: e.content, status: "complete" } : m);
      } else if (e.type === "session_status") {
        // session-status updates would be wired into the session store
      }
    },
    dismissError(index: number) {
      this.errors = this.errors.filter((_, i) => i !== index);
    },
    clearErrors() {
      this.errors = [];
    },
  },
});
