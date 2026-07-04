import { FastifyPluginAsync } from "fastify";
import { ClientEvent, ServerEvent } from "@pi-web-ui/shared";
import { RpcBridge } from "../agent/rpc-bridge.js";

export const agentRoutes: FastifyPluginAsync = async (app) => {
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
        bridge.onEvent((e) => {
          send(e);
          if (e.type === "message_end") {
            app.messages.append({ sessionId: e.sessionId, role: "assistant", content: e.content, metadata: e.metadata });
          }
        });
        proc.on("exit", (code: number | null) => send({ type: "session_status", sessionId: session.id, status: code === 0 ? "suspended" : "crashed" }));
        proc.on("stderr", (line: string) => send({ type: "error", sessionId: session.id, code: "agent_stderr", message: line }));
        state = app.sessionStates.set(session.id, proc, bridge);
        app.sessions.touch(session.id, "active");
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
