import type { FastifyPluginAsync } from "fastify";
import type { ConnectorToolPolicy, CreateConnectorInput } from "@pi-web-ui/shared";
import { ConnectorError } from "../connectors/types.js";

function errorReply(reply: any, error: unknown) {
  const status = error instanceof ConnectorError && error.code === "CONFIG_INVALID" ? 400 : 500;
  return reply.code(status).send({
    error: error instanceof Error ? error.message : String(error),
    code: error instanceof ConnectorError ? error.code : "INTERNAL_ERROR",
  });
}

export const connectorsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/connector-catalog", async () => app.connectorService.catalog());

  app.post<{ Params: { key: string }; Body: { token?: string } }>("/connector-catalog/:key/connect", async (req, reply) => {
    try { return reply.code(201).send(app.connectorService.connectBuiltin(req.params.key, req.body?.token ?? "")); }
    catch (error) { return errorReply(reply, error); }
  });

  app.get<{ Querystring: { workspaceId?: string } }>("/connectors", async (req) => app.connectorService.list(req.query.workspaceId));

  app.get<{ Params: { id: string } }>("/connectors/:id", async (req, reply) => {
    const connector = app.connectorService.get(req.params.id);
    return connector ?? reply.code(404).send({ error: "connector not found" });
  });

  app.post<{ Body: CreateConnectorInput }>("/connectors", async (req, reply) => {
    try { return reply.code(201).send(app.connectorService.create(req.body)); }
    catch (error) { return errorReply(reply, error); }
  });

  app.put<{ Params: { id: string }; Body: Partial<CreateConnectorInput> & { enabled?: boolean } }>("/connectors/:id", async (req, reply) => {
    try {
      const result = await app.connectorService.update(req.params.id, req.body);
      return result ?? reply.code(404).send({ error: "connector not found" });
    } catch (error) { return errorReply(reply, error); }
  });

  app.delete<{ Params: { id: string } }>("/connectors/:id", async (req, reply) => {
    return await app.connectorService.remove(req.params.id) ? reply.code(204).send() : reply.code(404).send({ error: "connector not found" });
  });

  app.post<{ Params: { id: string } }>("/connectors/:id/test", async (req, reply) => {
    const result = await app.connectorService.test(req.params.id);
    return reply.send(result);
  });

  app.post<{ Params: { id: string } }>("/connectors/:id/reconnect", async (req, reply) => {
    try { await app.connectorService.reconnect(req.params.id); return { ok: true }; }
    catch (error) { return errorReply(reply, error); }
  });

  app.get<{ Params: { id: string } }>("/connectors/:id/tools", async (req) => app.connectorService.listTools(req.params.id));
  app.patch<{ Params: { id: string; name: string }; Body: { enabled?: boolean; policy?: ConnectorToolPolicy } }>("/connectors/:id/tools/:name", async (req, reply) => {
    const tool = app.connectorService.setTool(req.params.id, req.params.name, req.body);
    return tool ?? reply.code(404).send({ error: "tool not found" });
  });
  app.get<{ Params: { id: string } }>("/connectors/:id/audits", async (req) => app.connectorService.listAudits(req.params.id));

  const authorize = (sessionId: string, token: unknown) => typeof token === "string" && app.processManager.validateConnectorToken(sessionId, token);
  const context = (sessionId: string) => {
    const session = app.sessions.findById(sessionId);
    const project = session && app.projects.findById(session.projectId);
    return session && project ? { session, project, invocation: { sessionId, workspaceId: project.id, source: "desktop" as const, cwd: project.workdir } } : null;
  };

  app.post<{ Params: { sessionId: string }; Body: { query?: string; limit?: number } }>("/internal/connectors/:sessionId/search", async (req, reply) => {
    if (!authorize(req.params.sessionId, req.headers["x-pi-connector-token"])) return reply.code(403).send({ error: "forbidden" });
    const resolved = context(req.params.sessionId);
    if (!resolved) return reply.code(404).send({ error: "session context missing" });
    return app.connectorService.searchTools(req.body.query ?? "", resolved.project.id, req.body.limit);
  });

  app.post<{ Params: { sessionId: string }; Body: { tool?: string } }>("/internal/connectors/:sessionId/describe", async (req, reply) => {
    if (!authorize(req.params.sessionId, req.headers["x-pi-connector-token"])) return reply.code(403).send({ error: "forbidden" });
    const resolved = context(req.params.sessionId);
    if (!resolved) return reply.code(404).send({ error: "session context missing" });
    try { return app.connectorService.describeTool(req.body.tool ?? "", resolved.project.id); }
    catch (error) { return errorReply(reply, error); }
  });

  app.post<{ Params: { sessionId: string }; Body: { tool?: string; arguments?: Record<string, unknown> } }>("/internal/connectors/:sessionId/call", async (req, reply) => {
    if (!authorize(req.params.sessionId, req.headers["x-pi-connector-token"])) return reply.code(403).send({ error: "forbidden" });
    const resolved = context(req.params.sessionId);
    if (!resolved) return reply.code(404).send({ error: "session context missing" });
    const controller = new AbortController();
    req.raw.once("aborted", () => controller.abort());
    try {
      return await app.connectorService.invoke(req.body.tool ?? "", req.body.arguments ?? {}, resolved.invocation, async () => {
        const state = app.sessionStates.get(resolved.session.id);
        if (!state) return false;
        return app.pluginPermissions.request({
          sessionId: resolved.session.id,
          pluginId: "connector",
          action: req.body.tool ?? "unknown",
          reason: "该连接器能力可能读取或更改外部服务中的数据",
          context: { target: req.body.tool },
          send: state.send,
          signal: controller.signal,
        });
      });
    } catch (error) { return errorReply(reply, error); }
  });
};
