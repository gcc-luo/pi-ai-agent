import { FastifyPluginAsync } from "fastify";
import { ClientEvent, ServerEvent, ToolCall } from "@pi-web-ui/shared";
import { RpcBridge } from "../agent/rpc-bridge.js";

export const agentRoutes: FastifyPluginAsync = async (app) => {
  const persistedToolCalls = new Map<string, { messageId: string; metadata: Record<string, unknown> }>();
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
          if (e.type === "message_end") {
            const metadata = e.metadata ?? {};
            const saved = app.messages.append({ sessionId: e.sessionId, role: "assistant", content: e.content, metadata });
            const toolCalls = Array.isArray(metadata.toolCalls) ? metadata.toolCalls as ToolCall[] : [];
            for (const toolCall of toolCalls) {
              persistedToolCalls.set(toolCall.toolCallId, { messageId: saved.id, metadata });
            }
          } else if (e.type === "tool_result") {
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
          }
        });
        proc.on("exit", (code: number | null) => state!.send({ type: "session_status", sessionId: session.id, status: code === 0 ? "suspended" : "crashed" }));
        proc.on("stderr", (line: string) => state!.send({ type: "error", sessionId: session.id, code: "agent_stderr", message: line }));
        app.sessions.touch(session.id, "active");
      } else {
        state.send = send;
      }

      app.sessionStates.touch(event.sessionId);
      if (event.type === "send" || event.type === "steer") {
        state.bridge.send({ type: event.type, sessionId: event.sessionId, content: event.content });
        app.messages.append({ sessionId: event.sessionId, role: "user", content: event.content });
      } else if (event.type === "interrupt") {
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
