import type { FastifyPluginAsync } from "fastify";

export const browserRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string } }>("/sessions/:id/browser", async (req, reply) => {
    const session = app.sessions.findById(req.params.id);
    if (!session) return reply.code(404).send({ error: "session not found" });
    const enabled = app.pluginManager.activeForSession(session.id).includes("browser-use");
    return app.browserManager.status(session.id, enabled);
  });

  app.put<{
    Params: { id: string };
    Body: { enabled?: boolean };
  }>("/sessions/:id/browser", async (req, reply) => {
    const session = app.sessions.findById(req.params.id);
    if (!session) return reply.code(404).send({ error: "session not found" });
    if (typeof req.body?.enabled !== "boolean") {
      return reply.code(400).send({ error: "enabled must be a boolean" });
    }
    app.processManager.revokePluginToken(session.id);
    app.pluginPermissions.cancelSession(session.id);
    const stopped = await app.processManager.stopAndWait(session.id);
    if (!stopped) {
      return reply.code(409).send({ error: "agent process is still stopping; retry shortly" });
    }
    app.sessionStates.delete(session.id);
    const selected = app.plugins.selectedForSession(session.id);
    const next = req.body.enabled
      ? [...new Set([...selected, "browser-use"])]
      : selected.filter((id) => id !== "browser-use");

    if (!req.body.enabled) {
      app.pluginManager.setSessionPlugins(session.id, next);
      await app.browserManager.close(session.id);
      return app.browserManager.status(session.id, false);
    }

    try {
      app.pluginManager.setSessionPlugins(session.id, next);
    } catch (error) {
      return reply.code(409).send({
        error: error instanceof Error ? error.message : String(error),
      });
    }
    // Browser runtime remains lazy and starts on the first browser tool call.
    return app.browserManager.status(session.id, true);
  });

  // Keep the old URL explicit rather than silently starting a second browser backend.
  app.post("/internal/browser/:id/action", async (_req, reply) =>
    reply.code(410).send({ error: "请通过 agent_browser 扩展操作浏览器。" }));
};
