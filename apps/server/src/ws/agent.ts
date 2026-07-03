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
        const proc = await app.processManager.start({ sessionId: session.id, projectId: project.id, workdir: project.workdir });
        const bridge = new RpcBridge({ stdin: proc.stdin, stdout: proc.stdout }, session.id);
        bridge.onEvent((e) => {
          send(e);
          if (e.type === "message_end") {
            app.messages.append({ sessionId: e.sessionId, role: "assistant", content: e.content, metadata: e.metadata });
          }
        });
        proc.on("exit", (code) => send({ type: "session_status", sessionId: session.id, status: code === 0 ? "suspended" : "crashed" }));
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
        state.bridge.send({ type: "switchModel", sessionId: event.sessionId, model: event.model });
      }
    });
  });
};
