import { defineStore } from "pinia";
import { wsClient } from "../api/ws.js";
import { api, type ModelOption } from "../api/client.js";
import { useSessionStore } from "./session.js";
import type { ModelDto, ServerEvent, MessagePart, ToolCall, ImageAttachment } from "@pi-web-ui/shared";

interface StreamMessage {
  id: string;
  role: "user" | "assistant";
  parts: MessagePart[];
  status: "streaming" | "complete" | "error";
  createdAt: number;
  metadata: Record<string, unknown> | null;
  error?: string;
}

type PermissionRequest = Extract<ServerEvent, { type: "permission_request" }>;

const PROMPT_ERROR_CODES = new Set([
  "pi_prompt_failed",
  "pi_prompt_write_failed",
  "pi_model_error",
  "agent_busy",
  "project_workdir_missing",
]);

function partsFromText(text: string): MessagePart[] {
  return text ? [{ kind: "text", text }] : [];
}

function imagePartsFromMeta(metadata: Record<string, unknown> | null): MessagePart[] {
  const images = Array.isArray(metadata?.images) ? metadata!.images : [];
  return images.filter((img: any) => img?.mediaType && img?.data).map((img: any): MessagePart => ({
    kind: "image", name: img.name ?? "image", mediaType: img.mediaType, data: img.data,
  }));
}

function partsFromPersisted(content: string | null, metadata: Record<string, unknown> | null): MessagePart[] {
  const imgParts = imagePartsFromMeta(metadata);
  const piParts = Array.isArray(metadata?.messageParts) ? metadata!.messageParts : [];
  const toolCalls = Array.isArray(metadata?.toolCalls) ? (metadata!.toolCalls as ToolCall[]) : [];
  if (piParts.length) {
    const mapped = piParts.flatMap((part: any): MessagePart[] => {
      if (part?.type === "text" && typeof part.text === "string") return [{ kind: "text", text: part.text }];
      if (part?.type === "thinking" && typeof part.thinking === "string") return [{ kind: "thinking", text: part.thinking }];
      if (part?.type === "toolCall" && part.id && part.name) {
        // Transcript synchronization restores Pi's original content blocks,
        // which do not contain execution results. Merge the separately
        // persisted ToolCall record so history keeps completion/error details.
        const toolCall = toolCalls.find((candidate) => candidate.toolCallId === part.id);
        return [{
          kind: "tool_call",
          toolCallId: part.id,
          name: part.name,
          args: part.arguments,
          status: toolCall?.status ?? (part.status === "running" ? "running" : "complete"),
          result: toolCall?.result ?? part.result,
        }];
      }
      return [{ kind: "raw", data: part as Record<string, unknown> }];
    });
    return [...imgParts, ...mapped];
  }
  const text = content ?? "";
  const parts: MessagePart[] = [...imgParts];
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
    initialized: false,
    streams: {} as Record<string, StreamMessage[]>,
    // Kept separately from message streaming: one agent run can produce many
    // assistant messages while it calls tools and resumes generation.
    runStates: {} as Record<string, "working" | "idle">,
    runStartedAt: {} as Record<string, number>,
    runOutcomes: {} as Record<string, "interrupted" | "failed" | undefined>,
    runEndedFromWorking: {} as Record<string, boolean>,
    // Pi may emit one model error for every automatic retry attempt. Keep the
    // latest one private until `agent_settled` confirms that the complete run
    // failed; a later successful assistant message clears it.
    pendingModelErrors: {} as Record<string, { code: string; message: string } | undefined>,
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
    // Cumulative token usage per session: { input, output } accumulated from
    // live message_end events and historical metadata.
    sessionTokens: {} as Record<string, { input: number; output: number }>,
    contextCompactions: {} as Record<string, {
      phase: "started" | "completed" | "failed";
      reason: "manual" | "threshold" | "overflow";
      tokensBefore?: number;
      estimatedTokensAfter?: number;
      willRetry?: boolean;
      error?: string;
      at: number;
    }>,
    pendingPermissions: {} as Record<string, PermissionRequest>,
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
    runStartedAtFor: (state) => (sessionId: string): number | null =>
      state.runStartedAt[sessionId] ?? null,
    runOutcomeFor: (state) => (sessionId: string): "interrupted" | "failed" | null =>
      state.runOutcomes[sessionId] ?? null,
    tokensFor: (state) => (sessionId: string): { input: number; output: number } =>
      state.sessionTokens[sessionId] ?? { input: 0, output: 0 },
    compactionFor: (state) => (sessionId: string) => state.contextCompactions[sessionId] ?? null,
  },
  actions: {
    init() {
      // App.vue can be remounted by development HMR. Registering another
      // listener on every mount makes each streaming delta append repeatedly
      // (for example, "Codex" becomes "CodCodCodexexex") until message_end
      // replaces it with the authoritative final response.
      if (this.initialized) return;
      this.initialized = true;
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
    async switchModel(model: string, sessionId?: string) {
      const previousModel = this.currentModel;
      const previousProvider = this.currentProvider;
      try {
        const cfg = await api.updateConfig(model);
        this.currentModel = cfg.model;
        this.currentProvider = cfg.provider;
        if (sessionId) wsClient.send({ type: "switchModel", sessionId, model });
      } catch (error) {
        this.currentModel = previousModel;
        this.currentProvider = previousProvider;
        this.errors = [...this.errors, {
          sessionId,
          code: "model_switch_failed",
          message: error instanceof Error ? error.message : "Failed to switch model",
        }];
        return;
      }
      try {
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
    send(sessionId: string, content: string, images?: ImageAttachment[]) {
      const messageId = this.appendUser(sessionId, content, images);
      this.runStates[sessionId] = "working";
      this.runStartedAt[sessionId] = Date.now();
      delete this.runOutcomes[sessionId];
      const event: Record<string, unknown> = { type: "send", sessionId, content };
      if (this.currentModel) event.model = this.currentModel;
      if (images?.length) event.images = images;
      if (!wsClient.send(event as any)) {
        this.markUserMessageFailed(sessionId, messageId, "connection_unavailable");
      }
      return messageId;
    },
    retryUserMessage(sessionId: string, messageId: string) {
      const message = (this.streams[sessionId] ?? []).find((item) => item.id === messageId && item.role === "user");
      if (!message) return false;
      const content = message.parts
        .filter((part): part is Extract<MessagePart, { kind: "text" }> => part.kind === "text")
        .map((part) => part.text)
        .join("\n");
      const images = message.parts
        .filter((part): part is Extract<MessagePart, { kind: "image" }> => part.kind === "image")
        .map((part) => ({ name: part.name, mediaType: part.mediaType, data: part.data }));
      this.streams[sessionId] = (this.streams[sessionId] ?? []).map((item) =>
        item.id === messageId ? { ...item, status: "complete" as const, error: undefined } : item,
      );
      this.runStates[sessionId] = "working";
      this.runStartedAt[sessionId] = Date.now();
      delete this.runOutcomes[sessionId];
      const sent = wsClient.send({
        type: "send",
        sessionId,
        content,
        ...(this.currentModel ? { model: this.currentModel } : {}),
        ...(images.length ? { images } : {}),
      });
      if (!sent) this.markUserMessageFailed(sessionId, messageId, "connection_unavailable");
      return sent;
    },
    removeLocalMessage(sessionId: string, messageId: string) {
      this.streams[sessionId] = (this.streams[sessionId] ?? []).filter((message) => message.id !== messageId);
    },
    interrupt(sessionId: string) {
      const pending = this.pendingPermissions[sessionId];
      if (pending) this.respondToPermission(sessionId, pending.requestId, false);
      // An interrupted retry cycle is user-cancelled, not a terminal provider
      // failure. Ignore any transient model error buffered for that run.
      delete this.pendingModelErrors[sessionId];
      this.runOutcomes[sessionId] = "interrupted";
      if (!wsClient.send({ type: "interrupt", sessionId })) {
        this.runStates[sessionId] = "idle";
        delete this.runStartedAt[sessionId];
      }
    },
    respondToPermission(sessionId: string, requestId: string, approved: boolean) {
      const pending = this.pendingPermissions[sessionId];
      if (!pending || pending.requestId !== requestId) return false;
      const sent = wsClient.send({ type: "permission_response", sessionId, requestId, approved });
      if (sent) delete this.pendingPermissions[sessionId];
      return sent;
    },
    subscribe(sessionId: string) {
      wsClient.subscribe(sessionId);
    },
    unsubscribe(sessionId: string) {
      wsClient.unsubscribe(sessionId);
    },
    addSessionTokens(sessionId: string, input: number, output: number) {
      const prev = this.sessionTokens[sessionId] ?? { input: 0, output: 0 };
      this.sessionTokens[sessionId] = { input: prev.input + input, output: prev.output + output };
    },
    appendUser(sessionId: string, content: string, images?: ImageAttachment[]) {
      const parts: MessagePart[] = [];
      if (images?.length) {
        for (const img of images) {
          parts.push({ kind: "image", name: img.name, mediaType: img.mediaType, data: img.data });
        }
      }
      if (content) parts.push({ kind: "text", text: content });
      const msg: StreamMessage = {
        id: `u-${Date.now()}`,
        role: "user",
        parts,
        status: "complete",
        createdAt: Date.now(),
        metadata: null,
      };
      this.streams[sessionId] = [...(this.streams[sessionId] ?? []), msg];
      return msg.id;
    },
    markUserMessageFailed(sessionId: string, messageId: string, error: string) {
      this.streams[sessionId] = (this.streams[sessionId] ?? []).map((message) =>
        message.id === messageId
          ? { ...message, status: "error" as const, error }
          : message,
      );
      this.runStates[sessionId] = "idle";
      delete this.runStartedAt[sessionId];
    },
    handle(e: ServerEvent) {
      if (e.type === "permission_request") {
        this.pendingPermissions[e.sessionId] = e;
        const remaining = Math.max(0, e.expiresAt - Date.now());
        window.setTimeout(() => {
          if (this.pendingPermissions[e.sessionId]?.requestId === e.requestId) {
            delete this.pendingPermissions[e.sessionId];
          }
        }, remaining);
        return;
      }
      if (e.type === "error") {
        if (e.sessionId && e.code === "pi_model_error" && this.runStates[e.sessionId] === "working") {
          this.pendingModelErrors[e.sessionId] = { code: e.code, message: e.message };
          // Each failed retry has its own message_start. Remove that empty
          // placeholder without exposing a retry button while Pi is still busy.
          const list = this.streams[e.sessionId] ?? [];
          const last = list[list.length - 1];
          if (last?.role === "assistant" && last.status === "streaming" && last.parts.length === 0) {
            this.streams[e.sessionId] = list.slice(0, -1);
          }
          return;
        }
        this.errors = [...this.errors, { sessionId: e.sessionId, code: e.code, message: e.message }];
        if (e.sessionId && e.code === "agent_busy") {
          const lastUser = [...(this.streams[e.sessionId] ?? [])]
            .reverse()
            .find((message) => message.role === "user");
          if (lastUser) {
            this.streams[e.sessionId] = (this.streams[e.sessionId] ?? []).map((message) =>
              message.id === lastUser.id
                ? { ...message, status: "error" as const, error: e.message }
                : message,
            );
          }
          return;
        }
        // A rejected prompt has no `agent_settled` event to close the run.
        if (e.sessionId && (
          e.code === "pi_prompt_failed"
          || e.code === "pi_prompt_write_failed"
          || e.code === "pi_model_error"
          || e.code === "project_workdir_missing"
        )) {
          this.runOutcomes[e.sessionId] = "failed";
          const lastUser = [...(this.streams[e.sessionId] ?? [])]
            .reverse()
            .find((message) => message.role === "user");
          if (lastUser) this.markUserMessageFailed(e.sessionId, lastUser.id, e.message);
          this.runStates[e.sessionId] = "idle";
          delete this.runStartedAt[e.sessionId];
          // Provider failures arrive after Pi has emitted message_start. Drop
          // the empty placeholder so the visible result is the error banner,
          // not a permanently blank PI Agent message.
          const list = this.streams[e.sessionId] ?? [];
          const last = list[list.length - 1];
          if (last?.role === "assistant" && last.status === "streaming" && last.parts.length === 0) {
            this.streams[e.sessionId] = list.slice(0, -1);
          }
        }
        return;
      }
      if (e.type === "session_updated") {
        const sessionStore = useSessionStore();
        const idx = sessionStore.sessions.findIndex((s) => s.id === e.session.id);
        if (idx >= 0) sessionStore.sessions.splice(idx, 1, e.session);
        if (sessionStore.current?.id === e.session.id) sessionStore.current = e.session;
        return;
      }
      if (e.type === "model_changed") {
        this.currentModel = e.model;
        this.currentProvider = e.provider;
        return;
      }
      if (!("sessionId" in e) || !e.sessionId) return;
      const sid = e.sessionId;
      if (e.type === "agent_status") {
        const wasWorking = this.runStates[sid] === "working";
        this.runStates[sid] = e.status;
        if (e.status === "working") {
          delete this.runEndedFromWorking[sid];
          delete this.runOutcomes[sid];
          if (!this.runStartedAt[sid]) this.runStartedAt[sid] = Date.now();
        } else {
          this.runEndedFromWorking[sid] = wasWorking;
          delete this.runStartedAt[sid];
          const pendingError = this.pendingModelErrors[sid];
          if (pendingError) {
            this.errors = [
              ...this.errors.filter((error) =>
                error.sessionId !== sid || error.code !== pendingError.code || error.message !== pendingError.message,
              ),
              { sessionId: sid, code: pendingError.code, message: pendingError.message },
            ];
            this.runOutcomes[sid] = "failed";
            const lastUser = [...(this.streams[sid] ?? [])]
              .reverse()
              .find((message) => message.role === "user");
            if (lastUser) this.markUserMessageFailed(sid, lastUser.id, pendingError.message);
            delete this.pendingModelErrors[sid];
          }
        }
        if (e.status === "idle" && typeof e.durationMs === "number") {
          const lastAssistant = [...(this.streams[sid] ?? [])]
            .reverse()
            .find((message) => message.role === "assistant");
          if (lastAssistant) {
            this.streams[sid] = (this.streams[sid] ?? []).map((message) =>
              message.id === lastAssistant.id
                ? {
                    ...message,
                    metadata: { ...(message.metadata ?? {}), durationMs: e.durationMs },
                  }
                : message,
            );
          }
        }
        return;
      }
      if (e.type === "session_status") {
        if (e.status === "suspended" || e.status === "crashed") {
          this.runStates[sid] = "idle";
          if (e.status === "crashed" && this.runEndedFromWorking[sid] === true) {
            this.runOutcomes[sid] = "failed";
          } else if (
            e.status === "suspended"
            && this.runOutcomes[sid] === "failed"
            && !(this.streams[sid] ?? []).some((message) => message.role === "user" && message.status === "error")
          ) {
            delete this.runOutcomes[sid];
          }
          delete this.runEndedFromWorking[sid];
          delete this.runStartedAt[sid];
        }
        return;
      }
      if (e.type === "context_compaction") {
        this.contextCompactions[sid] = {
          phase: e.phase,
          reason: e.reason,
          tokensBefore: e.tokensBefore,
          estimatedTokensAfter: e.estimatedTokensAfter,
          willRetry: e.willRetry,
          error: e.error,
          at: Date.now(),
        };
        return;
      }
      const list = this.streams[sid] ?? [];
      if (e.type === "message_start") {
        // Replayed/repeated transport boundaries must be idempotent. Updating
        // every later delta by id would otherwise make duplicate rows evolve
        // into the same visible assistant response.
        if (list.some((message) => message.id === e.messageId)) return;
        this.streams[sid] = [...list, {
          id: e.messageId,
          role: e.role,
          parts: [],
          status: "streaming",
          createdAt: e.timestamp ?? Date.now(),
          metadata: null,
        }];
      } else if (e.type === "message_delta") {
        this.streams[sid] = list.map((m) =>
          m.id === e.messageId ? { ...m, parts: appendDeltaToKind(m.parts, "text", e.delta) } : m,
        );
      } else if (e.type === "thinking_delta") {
        this.streams[sid] = list.map((m) =>
          m.id === e.messageId ? { ...m, parts: appendDeltaToKind(m.parts, "thinking", e.delta) } : m,
        );
      } else if (e.type === "message_end") {
        delete this.pendingModelErrors[sid];
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
          return { ...m, parts, status: "complete" as const, metadata: e.metadata ?? null };
        });
        // Accumulate token usage from the LLM response.
        // The Pi agent normalises provider usage into { input, output, totalTokens, ... }
        const usage = e.metadata?.usage as { input?: number; output?: number } | undefined;
        if (usage) {
          const input = usage.input ?? 0;
          const output = usage.output ?? 0;
          if (input > 0 || output > 0) this.addSessionTokens(sid, input, output);
        }
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
        if (e.data.type === "agent_settled" || e.data.type === "agent_end") this.runStates[sid] = "idle";
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
            metadata: null,
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
    dismissPromptErrors(sessionId: string) {
      this.errors = this.errors.filter((error) =>
        error.sessionId !== sessionId || !PROMPT_ERROR_CODES.has(error.code),
      );
    },
    clearErrors() {
      this.errors = [];
    },
  },
});

export { partsFromPersisted, partsFromText };
export type { StreamMessage };
