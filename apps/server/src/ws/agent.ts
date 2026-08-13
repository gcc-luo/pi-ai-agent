import { FastifyPluginAsync } from "fastify";
import fs from "node:fs";
import { ClientEvent, ImageAttachment, ServerEvent, ToolCall } from "@pi-web-ui/shared";
import { RpcBridge } from "../agent/rpc-bridge.js";
import { buildKbContext } from "../kb/inject-context.js";
import { resolveSearchScopes } from "../kb/search-scopes.js";
import { extractUserSearchQuery } from "../kb/query-text.js";
import { ulid } from "../util/ulid.js";

const DEFAULT_TITLE_MAX = 30;

// Global instruction appended to every user message so the agent knows to
// declare delivered files via the <artifacts> protocol. Only injected on the
// wire — the persisted user message remains the text the user actually wrote.
const ARTIFACT_INSTRUCTION = `<global-instruction>
当你创建或生成文件时，必须在回复末尾使用 <artifacts> 标签声明交付物。
格式：
<artifacts>
[{"path": "相对路径", "name": "文件名", "mimeType": "MIME类型"}]
</artifacts>

规则：
1. path 为相对于项目根目录的路径
2. 仅声明实际已写入磁盘的文件
3. 多个文件放在同一个 JSON 数组中
4. 不要声明中间产物或临时文件
</global-instruction>`;

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
const FILE_TOOLS = new Set([
  "write", "edit", "write_file", "edit_file", "create_file", "delete_file",
  "mkdir", "mv", "rm", "touch", "browser_screenshot", "browser_click",
  "computer_screenshot",
]);

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
  const persistedToolCalls = new Map<string, {
    sessionId: string;
    messageId: string;
    metadata: Record<string, unknown>;
  }>();
  // toolCallId -> toolName, populated on `tool_call`, drained on `tool_result`
  // so we know which executions should trigger a `file_changed` push.
  const fileModifyingToolCalls = new Map<string, string>();
  const finishPendingToolCalls = (sessionId: string, reason: string) => {
    const result = {
      content: [{ type: "text", text: reason }],
      isError: true,
    };
    for (const [toolCallId, persisted] of persistedToolCalls) {
      if (persisted.sessionId !== sessionId) continue;
      const toolCalls = Array.isArray(persisted.metadata.toolCalls)
        ? persisted.metadata.toolCalls as ToolCall[]
        : [];
      persisted.metadata.toolCalls = toolCalls.map((toolCall) =>
        toolCall.toolCallId === toolCallId
          ? { ...toolCall, status: "complete", result }
          : toolCall,
      );
      const messageParts = Array.isArray(persisted.metadata.messageParts)
        ? persisted.metadata.messageParts as Record<string, unknown>[]
        : [];
      persisted.metadata.messageParts = messageParts.map((part) =>
        part.type === "toolCall" && part.id === toolCallId
          ? { ...part, status: "complete", result }
          : part,
      );
      app.messages.updateMetadata(persisted.messageId, persisted.metadata);
      persistedToolCalls.delete(toolCallId);
      fileModifyingToolCalls.delete(toolCallId);
    }
  };

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

      if (event.type === "subscribe") {
        const state = app.sessionStates.get(session.id);
        if (state) state.send = send;
        send({
          type: "agent_status",
          sessionId: session.id,
          status: state?.runStatus ?? "idle",
        });
        send({
          type: "session_status",
          sessionId: session.id,
          status: state ? "active" : session.status,
        });
        return;
      }

      if (event.type === "permission_response") {
        const accepted = app.pluginPermissions?.respond(
          session.id,
          event.requestId,
          event.approved,
        ) ?? false;
        if (!accepted) {
          send({
            type: "error",
            sessionId: session.id,
            code: "permission_request_expired",
            message: "permission request is no longer pending",
          });
        }
        return;
      }

      const requestedModelId = event.type === "send" || event.type === "switchModel"
        ? event.model
        : undefined;
      const requestedModel = requestedModelId ? app.models.findById(requestedModelId) : null;
      if (requestedModelId && !requestedModel) {
        send({ type: "error", sessionId: event.sessionId, code: "model_not_found", message: "model not found" });
        return;
      }

      const project = app.projects.findById(session.projectId);
      if (!project) { send({ type: "error", sessionId: event.sessionId, code: "no_project", message: "project gone" }); return; }
      if (event.type === "send" || event.type === "steer" || event.type === "switchModel") {
        let workdirAvailable = false;
        try {
          workdirAvailable = fs.statSync(project.workdir).isDirectory();
        } catch {
          workdirAvailable = false;
        }
        if (!workdirAvailable) {
          send({
            type: "error",
            sessionId: event.sessionId,
            code: "project_workdir_missing",
            message: `项目工作目录不存在或不可访问：${project.workdir}`,
          });
          return;
        }
      }

      const startAgentState = async (model = requestedModel ?? app.models.getDefault()) => {
        app.log.info({ defaultModel: model ? `${model.provider}/${model.id} hasKey=${model.hasApiKey}` : "none" }, "resolving default model");
        const modelConfig = model ? {
          provider: model.provider,
          model: model.id,
          modelType: model.modelType,
          apiKey: app.models.getApiKey(model.id),
          apiBaseUrl: model.apiBaseUrl,
        } : undefined;
        app.log.info({ provider: modelConfig?.provider, model: modelConfig?.model, hasKey: !!modelConfig?.apiKey, baseUrl: modelConfig?.apiBaseUrl }, "model config resolved");

        const proc = await app.processManager.start({
          sessionId: session.id,
          projectId: project.id,
          workdir: project.workdir,
          modelConfig,
          activePluginIds: app.pluginManager?.activeForSession(session.id)
            ?? session.selectedPluginIds
            ?? (session.browserEnabled ? ["browser-use"] : []),
        });
        const bridge = new RpcBridge({ stdin: proc.stdin, stdout: proc.stdout }, session.id);
        const nextState = app.sessionStates.set(
          session.id,
          proc,
          bridge,
          modelConfig ? { provider: modelConfig.provider, model: modelConfig.model } : undefined,
        );
        nextState.send = send;
        let lastAssistantMessage: { id: string; metadata: Record<string, unknown> } | null = null;
        bridge.onEvent((e) => {
          if (e.type === "agent_status") {
            nextState.runStatus = e.status;
            if (e.status === "working") {
              lastAssistantMessage = null;
            } else if (typeof e.durationMs === "number" && lastAssistantMessage) {
              const metadata = { ...lastAssistantMessage.metadata, durationMs: e.durationMs };
              app.messages.updateMetadata(lastAssistantMessage.id, metadata);
              lastAssistantMessage = { ...lastAssistantMessage, metadata };
            }
          }
          nextState.send(e);
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
              nextState.send({ type: "file_changed", sessionId: e.sessionId, toolCallId: e.toolCallId, toolName });
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
            persistedToolCalls.delete(e.toolCallId);
          } else if (e.type === "message_end") {
            const metadata = e.metadata ?? {};
            const saved = app.messages.append({ sessionId: e.sessionId, role: "assistant", content: e.content, metadata, createdAt: e.timestamp });
            lastAssistantMessage = { id: saved.id, metadata };
            const toolCalls = Array.isArray(metadata.toolCalls) ? metadata.toolCalls as ToolCall[] : [];
            for (const toolCall of toolCalls) {
              persistedToolCalls.set(toolCall.toolCallId, {
                sessionId: e.sessionId,
                messageId: saved.id,
                metadata,
              });
            }
          }
        });
        proc.on("exit", () => {
          nextState.runStatus = "idle";
          finishPendingToolCalls(session.id, "Agent 进程已结束，工具调用未完成。");
          const status = proc.status === "crashed" ? "crashed" : "suspended";
          app.sessions.setStatus(session.id, status);
          nextState.send({ type: "agent_status", sessionId: session.id, status: "idle" });
          nextState.send({ type: "session_status", sessionId: session.id, status });
          if (app.sessionStates.get(session.id) === nextState) {
            app.sessionStates.delete(session.id);
          }
        });
        proc.on("stderr", (line: string) => nextState.send({ type: "error", sessionId: session.id, code: "agent_stderr", message: line }));
        app.sessions.touch(session.id, "active");
        nextState.send({ type: "session_status", sessionId: session.id, status: "active" });
        return nextState;
      };

      let state = app.sessionStates.get(event.sessionId);
      if (!state) {
        state = await startAgentState();
      } else if (
        requestedModel
        && (state.provider !== requestedModel.provider || state.model !== requestedModel.id)
      ) {
        await app.processManager.stopAndWait(session.id);
        const previousProcess = app.processManager.get(session.id);
        if (
          previousProcess
          && previousProcess.status !== "suspended"
          && previousProcess.status !== "crashed"
        ) {
          send({
            type: "error",
            sessionId: event.sessionId,
            code: "model_switch_failed",
            message: "failed to stop the current model process",
          });
          return;
        }
        state = await startAgentState(requestedModel);
      } else {
        state.send = send;
      }

      app.sessionStates.touch(event.sessionId);
      if (event.type === "send" || event.type === "steer") {
        // A normal prompt cannot be accepted while Pi is running. The web UI
        // normally prevents this, but the server must also enforce it because
        // client state can lag behind automatic provider retries.
        if (event.type === "send" && state.runStatus === "working") {
          send({
            type: "error",
            sessionId: session.id,
            code: "agent_busy",
            message: "模型仍在处理上一条消息，请等待完成后再发送。",
          });
          return;
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
            const searchQuery = extractUserSearchQuery(event.content);

            console.log(`[WS Agent] KB search start: messageId=${messageId} kbIds=[${kbIds.join(",")}] fileIds=${fileIds ? `[${fileIds.join(",")}]` : "all"}`);

            send({
              type: "kb_search", sessionId: session.id, messageId,
              phase: "searching", query: searchQuery, kbIds, fileIds,
            });

            try {
              const searchStart = Date.now();

              const scopes = resolveSearchScopes(app, enabledBindings.map((binding) => ({
                kbId: binding.kbId,
                fileIds: binding.fileFilter,
              })));

              const result = await app.kbSearch.search({
                query: searchQuery, scopes, limit: 5,
              });
              const searchMs = Date.now() - searchStart;
              console.log(`[WS Agent] KB search done: hits=${result.hits.length} time=${searchMs}ms vectorScopes=${scopes.filter((scope) => scope.embeddingModel).length}`);

              if (result.hits.length > 0) {
                const { contextBlock, chunkMap } = buildKbContext(result.hits);
                console.log(`[WS Agent] KB context built: blockLen=${contextBlock.length} chunks=${Object.keys(chunkMap).length}`);
                send({
                  type: "kb_search", sessionId: session.id, messageId,
                  phase: "done", query: searchQuery, kbIds, fileIds,
                  hits: result.hits, chunkMap, durationMs: result.durationMs,
                });
                content = `${contextBlock}\n\n${content}`;
                kbSearchMeta = {
                  phase: "done", query: searchQuery, kbIds, fileIds,
                  hits: result.hits.map((h, i) => ({
                    localId: i + 1, chunkId: h.chunkId, segmentId: h.segmentId,
                    revision: h.revision, kbName: h.kbName,
                    fileName: h.fileName, titlePath: h.titlePath,
                    pageStart: h.pageStart, pageEnd: h.pageEnd,
                  })),
                  durationMs: result.durationMs, timestamp: Date.now(),
                };
              } else {
                console.log(`[WS Agent] KB search empty: no hits for query`);
                send({
                  type: "kb_search", sessionId: session.id, messageId,
                  phase: "empty", query: searchQuery, kbIds, fileIds,
                });
              }
            } catch (err: any) {
              console.error(`[WS Agent] KB search failed: ${err.message}`);
              if (err.stack) console.error(err.stack);
              send({
                type: "kb_search", sessionId: session.id, messageId,
                phase: "failed", query: searchQuery, kbIds, fileIds,
                error: err.message,
              });
            }
          }
        }

        // Validate image attachments (send only)
        if (event.type === "send" && event.images?.length) {
          const IMAGE_LIMIT = 5;
          const SIZE_LIMIT = 5 * 1024 * 1024; // 5MB per image (raw, before base64)
          const ALLOWED_MEDIA = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
          if (event.images.length > IMAGE_LIMIT) {
            send({ type: "error", sessionId: session.id, code: "too_many_images", message: `Maximum ${IMAGE_LIMIT} images per message` });
            return;
          }
          for (const img of event.images) {
            if (!ALLOWED_MEDIA.has(img.mediaType)) {
              send({ type: "error", sessionId: session.id, code: "unsupported_image", message: `Unsupported image type: ${img.mediaType}` });
              return;
            }
            const estimatedRawSize = (img.data.length * 3) / 4;
            if (estimatedRawSize > SIZE_LIMIT) {
              send({ type: "error", sessionId: session.id, code: "image_too_large", message: `Image too large: ${img.name} (max 5MB)` });
              return;
            }
          }
        }

        // The expert assignment belongs to the session, not one individual
        // prompt. Read it for every turn so selecting, replacing, or clearing
        // an expert takes effect immediately, including in an already-running
        // conversation. The injected instruction is sent only to Pi; the
        // persisted user message below remains the text the user actually wrote.
        if (event.type === "send" && session.expertId) {
          const expert = app.experts.findById(session.expertId);
          if (expert?.systemPrompt) {
            content = `<system-instruction>\n${expert.systemPrompt}\n</system-instruction>\n\n${content}`;
            console.log(`[WS Agent] expert system prompt injected: sessionId=${session.id} expertId=${expert.id} promptLen=${expert.systemPrompt.length}`);
          }
        }

        // Inject global artifact delivery instruction on every send
        if (event.type === "send" && content) {
          content = `${content}\n\n${ARTIFACT_INSTRUCTION}`;
        }

        if (event.type === "send") {
          // Do this only after all synchronous validation has passed. A
          // rejected image must not leave the composer in a perpetual
          // "working" state.
          state.runStatus = "working";
          state.send({ type: "agent_status", sessionId: session.id, status: "working" });
        }
        console.log(`[WS Agent] forwarding to bridge: type=${event.type} contentLen=${content?.length ?? 0} images=${event.type === "send" ? (event.images?.length ?? 0) : 0}`);
        const bridgePayload: Record<string, unknown> = { type: event.type, sessionId: event.sessionId, content };
        if (event.type === "send" && event.images?.length) {
          bridgePayload.images = event.images;
        }
        state.bridge.send(bridgePayload);
        console.log(`[WS Agent] bridge.send completed, appending message`);

        const msgMeta: Record<string, unknown> = {};
        if (kbSearchMeta) msgMeta.kbSearch = kbSearchMeta;
        if (event.type === "send" && event.images?.length) {
          msgMeta.images = event.images.map((img: ImageAttachment) => ({
            name: img.name, mediaType: img.mediaType, data: img.data,
          }));
        }
        const hasMeta = Object.keys(msgMeta).length > 0;
        app.messages.append({ sessionId: event.sessionId, role: "user", content: event.content, metadata: hasMeta ? msgMeta : undefined as any });
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
        app.pluginPermissions?.cancelSession(session.id);
        state.runStatus = "idle";
        state.send({ type: "agent_status", sessionId: session.id, status: "idle" });
        state.process.kill();
      } else if (event.type === "switchModel") {
        state.send({
          type: "model_changed",
          sessionId: event.sessionId,
          provider: state.provider!,
          model: state.model!,
        });
      }
    });
  });
};
