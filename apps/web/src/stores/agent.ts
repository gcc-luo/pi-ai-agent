import { defineStore } from "pinia";
import { wsClient } from "../api/ws.js";
import type { ServerEvent } from "@pi-web-ui/shared";

interface StreamMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "streaming" | "complete";
}

export const useAgentStore = defineStore("agent", {
  state: () => ({
    streams: {} as Record<string, StreamMessage[]>,
  }),
  getters: {
    messagesFor: (state) => (sessionId: string): StreamMessage[] => state.streams[sessionId] ?? [],
  },
  actions: {
    init() {
      wsClient.onEvent((e) => this.handle(e));
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
  },
});
