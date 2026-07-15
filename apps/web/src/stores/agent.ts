import { defineStore } from "pinia";
import { wsClient } from "../api/ws.js";
import { api, type ModelOption } from "../api/client.js";
import { useSessionStore } from "./session.js";
import type { ModelDto, ServerEvent, MessagePart, ToolCall } from "@pi-web-ui/shared";

interface StreamMessage {
  id: string;
  role: "user" | "assistant";
  parts: MessagePart[];
  status: "streaming" | "complete" | "error";
  createdAt: number;
}

function partsFromText(text: string): MessagePart[] {
  return text ? [{ kind: "text", text }] : [];
}

function partsFromPersisted(content: string | null, metadata: Record<string, unknown> | null): MessagePart[] {
  const piParts = Array.isArray(metadata?.messageParts) ? metadata!.messageParts : [];
  if (piParts.length) {
    return piParts.flatMap((part: any): MessagePart[] => {
      if (part?.type === "text" && typeof part.text === "string") return [{ kind: "text", text: part.text }];
      if (part?.type === "thinking" && typeof part.thinking === "string") return [{ kind: "thinking", text: part.thinking }];
      if (part?.type === "toolCall" && part.id && part.name) {
        return [{
          kind: "tool_call",
          toolCallId: part.id,
          name: part.name,
          args: part.arguments,
          status: part.status === "running" ? "running" : "complete",
          result: part.result,
        }];
      }
      return [{ kind: "raw", data: part as Record<string, unknown> }];
    });
  }
  const text = content ?? "";
  const toolCalls = Array.isArray(metadata?.toolCalls) ? (metadata!.toolCalls as ToolCall[]) : [];
  const parts: MessagePart[] = [];
  if (text) parts.push({ kind: "text", text });
  for (const tc of toolCalls) {
    parts.push({ kind: "tool_call", toolCallId: tc.toolCallId, name: tc.name, args: tc.args, status: tc.status, result: tc.result });
  }
  return parts;
}

function appendDeltaToKind(parts: MessagePart[], kind: "text" | "thinking", delta: string): MessagePart[] {
  const next = [...parts];
  const last = next[next.length - 1];
  if (last && last.kind === kind) {
    next[next.length - 1] = { ...last, text: last.text + delta } as MessagePart;
  } else {
    next.push({ kind, text: delta } as MessagePart);
  }
  return next;
}

export const useAgentStore = defineStore("agent", {
  state: () => ({
    streams: {} as Record<string, StreamMessage[]>,
    // Kept separately from message streaming: one agent run can produce many
    // assistant messages while it calls tools and resumes generation.
    runStates: {} as Record<string, "working" | "idle">,
    errors: [] as { sessionId?: string; code: string; message: string }[],
    currentModel: null as string | null,
    currentProvider: null as string | null,
    models: [] as ModelOption[],
    modelDtos: [] as ModelDto[],
    // Bumped whenever a file-modifying tool completes; FileTree watches this
    // to debounce-refresh its tree without coupling to a specific session.
    fileChangeSeq: 0,
    lastFileChange: null as { sessionId: string; toolName: string; at: number } | null,
    // KB search states keyed by sessionId — each entry tracks the latest
    // kb_search event for that session so the chat panel can render the
    // call card under the user message that triggered the search.
    kbSearches: {} as Record<string, { phase: string; query: string; hits?: any[]; durationMs?: number; error?: string; at: number }>,
  }),
  getters: {
    messagesFor: (state) => (sessionId: string): StreamMessage[] => state.streams[sessionId] ?? [],
    currentModelLabel: (state) => {
      const m = state.models.find((m) => m.id === state.currentModel);
      return m?.label ?? state.currentModel ?? "";
    },
    // True for the entire prompt lifecycle, rather than a single assistant
    // message. This makes independently running sessions safe to render in
    // parallel without their controls flickering between model turns.
    isSessionBusy: (state) => (sessionId: string): boolean => {
      return state.runStates[sessionId] === "working";
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
    async createModel(data: { id: string; label: string; provider: string; modelType?: string; apiBaseUrl?: string; apiKey?: string; isDefault?: boolean }) {
      const m = await api.createModel(data);
      this.modelDtos = [...this.modelDtos, m];
      await this.loadConfig();
      return m;
    },
    async updateModel(id: string, data: { label?: string; provider?: string; modelType?: string; apiBaseUrl?: string | null; apiKey?: string | null; isDefault?: boolean }) {
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
      this.runStates[sessionId] = "working";
      wsClient.send({ type: "send", sessionId, content });
    },
    interrupt(sessionId: string) {
      wsClient.send({ type: "interrupt", sessionId });
    },
    appendUser(sessionId: string, content: string) {
      const msg: StreamMessage = { id: `u-${Date.now()}`, role: "user", parts: partsFromText(content), status: "complete", createdAt: Date.now() };
      this.streams[sessionId] = [...(this.streams[sessionId] ?? []), msg];
    },
    handle(e: ServerEvent) {
      if (e.type === "error") {
        this.errors = [...this.errors, { sessionId: e.sessionId, code: e.code, message: e.message }];
        // A rejected prompt has no `agent_settled` event to close the run.
        if (e.sessionId && e.code === "pi_prompt_failed") this.runStates[e.sessionId] = "idle";
        return;
      }
      if (e.type === "session_updated") {
        const sessionStore = useSessionStore();
        const idx = sessionStore.sessions.findIndex((s) => s.id === e.session.id);
        if (idx >= 0) sessionStore.sessions.splice(idx, 1, e.session);
        if (sessionStore.current?.id === e.session.id) sessionStore.current = e.session;
        return;
      }
      if (!("sessionId" in e) || !e.sessionId) return;
      const sid = e.sessionId;
      if (e.type === "agent_status") {
        this.runStates[sid] = e.status;
        return;
      }
      if (e.type === "session_status") {
        if (e.status === "suspended" || e.status === "crashed") this.runStates[sid] = "idle";
        return;
      }
      const list = this.streams[sid] ?? [];
      if (e.type === "message_start") {
        this.streams[sid] = [...list, { id: e.messageId, role: e.role, parts: [], status: "streaming", createdAt: e.timestamp ?? Date.now() }];
      } else if (e.type === "message_delta") {
        this.streams[sid] = list.map((m) =>
          m.id === e.messageId ? { ...m, parts: appendDeltaToKind(m.parts, "text", e.delta) } : m,
        );
      } else if (e.type === "thinking_delta") {
        this.streams[sid] = list.map((m) =>
          m.id === e.messageId ? { ...m, parts: appendDeltaToKind(m.parts, "thinking", e.delta) } : m,
        );
      } else if (e.type === "message_end") {
        this.streams[sid] = list.map((m) => {
          if (m.id !== e.messageId) return m;
          let parts = m.parts;
          const finalText = e.content ?? "";
          if (finalText) {
            const nonText = parts.filter((p) => p.kind !== "text");
            parts = [{ kind: "text", text: finalText }, ...nonText];
          }
          const toolCalls = Array.isArray(e.metadata?.toolCalls) ? (e.metadata!.toolCalls as ToolCall[]) : [];
          const persistedParts = partsFromPersisted(e.content, e.metadata ?? null);
          if (persistedParts.length) {
            // The completed message is authoritative: it retains Pi's original
            // text/thinking/tool-call order instead of leaving an empty bubble.
            parts = persistedParts;
          } else if (toolCalls.length) {
            parts = parts.filter((p) => p.kind !== "tool_call");
            for (const tc of toolCalls) {
              parts.push({ kind: "tool_call", toolCallId: tc.toolCallId, name: tc.name, args: tc.args, status: tc.status, result: tc.result });
            }
          }
          return { ...m, parts, status: "complete" as const };
        });
      } else if (e.type === "tool_call") {
        this.streams[sid] = list.map((m) => {
          if (m.id !== e.messageId) return m;
          const exists = m.parts.some((p) => p.kind === "tool_call" && p.toolCallId === e.toolCallId);
          if (exists) return m;
          const parts = [...m.parts, { kind: "tool_call" as const, toolCallId: e.toolCallId, name: e.name, args: e.args, status: "running" as const }];
          return { ...m, parts };
        });
      } else if (e.type === "tool_progress") {
        this.streams[sid] = list.map((m) => {
          const part = m.parts.find((p) => p.kind === "tool_call" && p.toolCallId === e.toolCallId);
          if (!part || part.kind !== "tool_call") return m;
          const progress = [...(part.progress ?? []), e.partial];
          const parts = m.parts.map((p) => p.kind === "tool_call" && p.toolCallId === e.toolCallId ? { ...p, progress } : p);
          return { ...m, parts };
        });
      } else if (e.type === "tool_result") {
        this.streams[sid] = list.map((m) => {
          if (!m.parts.some((p) => p.kind === "tool_call" && p.toolCallId === e.toolCallId)) return m;
          const parts = m.parts.map((p) =>
            p.kind === "tool_call" && p.toolCallId === e.toolCallId
              ? { ...p, result: e.result, status: "complete" as const }
              : p,
          );
          return { ...m, parts };
        });
      } else if (e.type === "file_changed") {
        this.fileChangeSeq++;
        this.lastFileChange = { sessionId: e.sessionId, toolName: e.toolName, at: Date.now() };
      } else if (e.type === "kb_search") {
        this.kbSearches[sid] = {
          phase: e.phase,
          query: e.query,
          hits: e.hits,
          durationMs: e.durationMs,
          error: e.error,
          at: Date.now(),
        };
      } else if (e.type === "raw") {
        // Compatibility fallback for servers that have not yet been upgraded
        // to emit `agent_status`.
        if (e.data.type === "agent_start") this.runStates[sid] = "working";
        if (e.data.type === "agent_settled") this.runStates[sid] = "idle";
        // Attach raw events to the most recent assistant message (any status) so the
        // full event stream is visible. If none exists yet, create a holding message.
        const lastAssistant = [...list].reverse().find((m) => m.role === "assistant");
        if (!lastAssistant) {
          const holder: StreamMessage = {
            id: `raw-${Date.now()}`,
            role: "assistant",
            parts: [{ kind: "raw" as const, data: e.data }],
            status: "complete",
            createdAt: Date.now(),
          };
          this.streams[sid] = [...list, holder];
          return;
        }
        this.streams[sid] = list.map((m) =>
          m.id === lastAssistant.id
            ? { ...m, parts: [...m.parts, { kind: "raw" as const, data: e.data }] }
            : m,
        );
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

export { partsFromPersisted, partsFromText };
export type { StreamMessage };
