import { FastifyPluginAsync } from "fastify";
import { ClientEvent, ServerEvent, ToolCall } from "@pi-web-ui/shared";
import { RpcBridge } from "../agent/rpc-bridge.js";
import { buildKbContext } from "../kb/inject-context.js";
import { ulid } from "../util/ulid.js";

const DEFAULT_TITLE_MAX = 30;

export function deriveDefaultTitle(content: string): string | null {
  const normalized = content.trim().replace(/\s+/g, " ");
  if (!normalized) return null;
  return normalized.length > DEFAULT_TITLE_MAX
    ? normalized.slice(0, DEFAULT_TITLE_MAX) + "…"
    : normalized;
}

// Tools whose execution mutates files inside the project workdir. Used to
// decide when to emit a `file_changed` ServerEvent so the client can refresh
// its file tree. `bash` is special-cased because file ops happen inside the
// shell command — we scan for common file-modifying subcommands.
const FILE_TOOLS = new Set(["write", "edit", "write_file", "edit_file", "create_file", "delete_file", "mkdir", "mv", "rm", "touch"]);

function bashModifiesFiles(command: string): boolean {
  // Conservative heuristic: refresh whenever the shell command uses a file
  // mutating builtin or a redirect. False positives are cheap (one extra
  // tree fetch); false negatives risk a stale file view.
  if (/\b(rm|mv|cp|mkdir|touch|rmdir|ln|truncate|chmod|chown|install|rsync|scp)\b/.test(command)) return true;
  if (/>>?/.test(command)) return true; // output redirect writes a file
  if (/\|\s*tee\b/.test(command)) return true;
  return false;
}

function isFileModifyingTool(name: string, args: unknown): boolean {
  const lower = name.toLowerCase();
  if (FILE_TOOLS.has(lower)) return true;
  if (lower === "bash" || lower === "shell" || lower === "execute_bash") {
    const cmd = (args as { command?: unknown } | null)?.command;
    return typeof cmd === "string" && bashModifiesFiles(cmd);
  }
  return false;
}

export const agentRoutes: FastifyPluginAsync = async (app) => {
  const persistedToolCalls = new Map<string, { messageId: string; metadata: Record<string, unknown> }>();
  // toolCallId -> toolName, populated on `tool_call`, drained on `tool_result`
  // so we know which executions should trigger a `file_changed` push.
  const fileModifyingToolCalls = new Map<string, string>();
  app.get("/ws/agent", { websocket: true }, (connection) => {
    const send = (event: ServerEvent) => {
      try { connection.send(JSON.stringify(event)); } catch {}
    };

    connection.on("message", async (raw: Buffer) => {
      let event: ClientEvent;
      try { event = JSON.parse(raw.toString()) as ClientEvent; } catch { return; }
      if (event.type === "ping") { send({ type: "pong" }); return; }

      const session = app.sessions.findById(event.sessionId);
      if (!session) { send({ type: "error", sessionId: event.sessionId, code: "no_session", message: "session not found" }); return; }

      let state = app.sessionStates.get(event.sessionId);
      if (!state) {
        const project = app.projects.findById(session.projectId);
        if (!project) { send({ type: "error", sessionId: event.sessionId, code: "no_project", message: "project gone" }); return; }

        const defaultModel = app.models.getDefault();
        app.log.info({ defaultModel: defaultModel ? `${defaultModel.provider}/${defaultModel.id} hasKey=${defaultModel.hasApiKey}` : "none" }, "resolving default model");
        const modelConfig = defaultModel ? {
          provider: defaultModel.provider,
          model: defaultModel.id,
          apiKey: app.models.getApiKey(defaultModel.id),
          apiBaseUrl: defaultModel.apiBaseUrl,
        } : undefined;
        app.log.info({ provider: modelConfig?.provider, model: modelConfig?.model, hasKey: !!modelConfig?.apiKey, baseUrl: modelConfig?.apiBaseUrl }, "model config resolved");

        const proc = await app.processManager.start({ sessionId: session.id, projectId: project.id, workdir: project.workdir, modelConfig });
        const bridge = new RpcBridge({ stdin: proc.stdin, stdout: proc.stdout }, session.id);
        state = app.sessionStates.set(session.id, proc, bridge);
        state.send = send;
        bridge.onEvent((e) => {
          state!.send(e);
          if (e.type === "tool_call") {
            if (isFileModifyingTool(e.name, e.args)) {
              fileModifyingToolCalls.set(e.toolCallId, e.name);
            }
          } else if (e.type === "tool_result") {
            // Persisted tool-call metadata may not exist yet (it's attached on
            // `message_end`), but we still drain the file-modifying flag here so
            // the client refreshes immediately after the tool finishes.
            const toolName = fileModifyingToolCalls.get(e.toolCallId);
            if (toolName) {
              fileModifyingToolCalls.delete(e.toolCallId);
              state!.send({ type: "file_changed", sessionId: e.sessionId, toolCallId: e.toolCallId, toolName });
            }

            const persisted = persistedToolCalls.get(e.toolCallId);
            if (!persisted) return;
            const toolCalls = Array.isArray(persisted.metadata.toolCalls) ? persisted.metadata.toolCalls as ToolCall[] : [];
            persisted.metadata.toolCalls = toolCalls.map((toolCall) =>
              toolCall.toolCallId === e.toolCallId
                ? { ...toolCall, status: "complete", result: e.result }
                : toolCall,
            );
            const messageParts = Array.isArray(persisted.metadata.messageParts) ? persisted.metadata.messageParts as Record<string, unknown>[] : [];
            persisted.metadata.messageParts = messageParts.map((part) =>
              part.type === "toolCall" && part.id === e.toolCallId
                ? { ...part, result: e.result, status: "complete" }
                : part,
            );
            app.messages.updateMetadata(persisted.messageId, persisted.metadata);
          } else if (e.type === "message_end") {
            const metadata = e.metadata ?? {};
            const saved = app.messages.append({ sessionId: e.sessionId, role: "assistant", content: e.content, metadata, createdAt: e.timestamp });
            const toolCalls = Array.isArray(metadata.toolCalls) ? metadata.toolCalls as ToolCall[] : [];
            for (const toolCall of toolCalls) {
              persistedToolCalls.set(toolCall.toolCallId, { messageId: saved.id, metadata });
            }
          }
        });
        proc.on("exit", (code: number | null) => {
          state!.send({ type: "agent_status", sessionId: session.id, status: "idle" });
          state!.send({ type: "session_status", sessionId: session.id, status: code === 0 ? "suspended" : "crashed" });
          app.sessionStates.delete(session.id);
        });
        proc.on("stderr", (line: string) => state!.send({ type: "error", sessionId: session.id, code: "agent_stderr", message: line }));
        app.sessions.touch(session.id, "active");
      } else {
        state.send = send;
      }

      app.sessionStates.touch(event.sessionId);
      if (event.type === "send" || event.type === "steer") {
        if (event.type === "send") {
          state.send({ type: "agent_status", sessionId: session.id, status: "working" });
        }

        console.log(`[WS Agent] received: type=${event.type} sessionId=${event.sessionId} contentLen=${event.content?.length ?? 0}`);

        // KB search interception: inject context before forwarding to Pi
        let content = event.content;
        let kbSearchMeta: Record<string, unknown> | undefined;

        if (event.type === "send") {
          const bindings = app.kbBindings.listBySession(event.sessionId);
          const enabledBindings = bindings.filter((b) => b.enabled);
          console.log(`[WS Agent] KB bindings: total=${bindings.length} enabled=${enabledBindings.length}`);

          if (enabledBindings.length > 0) {
            const messageId = ulid();
            const kbIds = enabledBindings.map((b) => b.kbId);
            const allFileIds = enabledBindings.flatMap((b) => b.fileFilter ?? []);
            const fileIds = allFileIds.length > 0 ? allFileIds : undefined;

            console.log(`[WS Agent] KB search start: messageId=${messageId} kbIds=[${kbIds.join(",")}] fileIds=${fileIds ? `[${fileIds.join(",")}]` : "all"}`);

            send({
              type: "kb_search", sessionId: session.id, messageId,
              phase: "searching", query: event.content, kbIds, fileIds,
            });

            try {
              const searchStart = Date.now();
              const result = await app.kbSearch.search({ query: event.content, kbIds, fileIds, limit: 5 });
              const searchMs = Date.now() - searchStart;
              console.log(`[WS Agent] KB search done: hits=${result.hits.length} time=${searchMs}ms`);

              if (result.hits.length > 0) {
                const { contextBlock, chunkMap } = buildKbContext(result.hits);
                console.log(`[WS Agent] KB context built: blockLen=${contextBlock.length} chunks=${Object.keys(chunkMap).length}`);
                send({
                  type: "kb_search", sessionId: session.id, messageId,
                  phase: "done", query: event.content, kbIds, fileIds,
                  hits: result.hits, chunkMap, durationMs: result.durationMs,
                });
                content = `${contextBlock}\n\n${content}`;
                kbSearchMeta = {
                  phase: "done", query: event.content, kbIds, fileIds,
                  hits: result.hits.map((h, i) => ({
                    localId: i + 1, chunkId: h.chunkId, kbName: h.kbName,
                    fileName: h.fileName, titlePath: h.titlePath,
                    pageStart: h.pageStart, pageEnd: h.pageEnd,
                  })),
                  durationMs: result.durationMs, timestamp: Date.now(),
                };
              } else {
                console.log(`[WS Agent] KB search empty: no hits for query`);
                send({
                  type: "kb_search", sessionId: session.id, messageId,
                  phase: "empty", query: event.content, kbIds, fileIds,
                });
              }
            } catch (err: any) {
              console.error(`[WS Agent] KB search failed: ${err.message}`);
              if (err.stack) console.error(err.stack);
              send({
                type: "kb_search", sessionId: session.id, messageId,
                phase: "failed", query: event.content, kbIds, fileIds,
                error: err.message,
              });
            }
          }
        }

        console.log(`[WS Agent] forwarding to bridge: type=${event.type} contentLen=${content?.length ?? 0}`);
        state.bridge.send({ type: event.type, sessionId: event.sessionId, content });
        console.log(`[WS Agent] bridge.send completed, appending message`);

        const msgMeta = kbSearchMeta ? { kbSearch: kbSearchMeta } : undefined;
        app.messages.append({ sessionId: event.sessionId, role: "user", content, metadata: msgMeta as any });
        console.log(`[WS Agent] message persisted`);
        if (event.type === "send" && session.title == null) {
          const derived = deriveDefaultTitle(event.content);
          if (derived) {
            app.sessions.touch(session.id, "active", { title: derived });
            const updated = app.sessions.findById(session.id);
            if (updated) send({ type: "session_updated", session: updated });
          }
        }
      } else if (event.type === "interrupt") {
        state.send({ type: "agent_status", sessionId: session.id, status: "idle" });
        state.process.kill();
      } else if (event.type === "switchModel") {
        const model = app.models.findById(event.model);
        if (!model) {
          send({ type: "error", sessionId: event.sessionId, code: "model_not_found", message: "model not found" });
          return;
        }
        state.bridge.send({ type: "switchModel", sessionId: event.sessionId, provider: model.provider, model: model.id });
      }
    });
  });
};
