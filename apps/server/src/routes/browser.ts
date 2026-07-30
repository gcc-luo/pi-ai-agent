import type { FastifyPluginAsync } from "fastify";

const ACTIONS = new Set([
  "open",
  "navigate",
  "snapshot",
  "click",
  "fill",
  "select",
  "press",
  "hover",
  "scroll",
  "wait",
  "tabs",
  "screenshot",
  "console_errors",
  "network_errors",
  "close",
]);

export const browserRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string } }>("/sessions/:id/browser", async (req, reply) => {
    const session = app.sessions.findById(req.params.id);
    if (!session) return reply.code(404).send({ error: "session not found" });
    return app.browserManager.status(session.id, session.browserEnabled);
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
    const project = app.projects.findById(session.projectId);
    if (!project) return reply.code(404).send({ error: "project not found" });

    const stopped = await app.processManager.stopAndWait(session.id);
    if (!stopped) {
      return reply.code(409).send({ error: "agent process is still stopping; retry shortly" });
    }
    app.sessionStates.delete(session.id);
    app.sessions.setBrowserEnabled(session.id, req.body.enabled);

    if (!req.body.enabled) {
      await app.browserManager.close(session.id);
      return app.browserManager.status(session.id, false);
    }

    try {
      await app.browserManager.open(session.id, project.workdir);
    } catch {
      // Preserve the enabled setting and expose the startup error in status.
      // browser_open can retry after the local Chromium installation is fixed.
    }
    return app.browserManager.status(session.id, true);
  });

  app.post<{
    Params: { id: string };
    Body: { action?: string; args?: Record<string, unknown> };
  }>("/internal/browser/:id/action", async (req, reply) => {
    const token = req.headers["x-pi-browser-token"];
    if (
      typeof token !== "string"
      || !app.processManager.validateBrowserToken(req.params.id, token)
    ) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const session = app.sessions.findById(req.params.id);
    if (!session) return reply.code(404).send({ error: "session not found" });
    if (!session.browserEnabled) {
      return reply.code(409).send({ error: "browser capability is disabled for this session" });
    }
    const project = app.projects.findById(session.projectId);
    if (!project) return reply.code(404).send({ error: "project not found" });
    const action = req.body?.action;
    if (!action || !ACTIONS.has(action)) {
      return reply.code(400).send({ error: "invalid browser action" });
    }
    try {
      return await app.browserManager.execute({
        sessionId: session.id,
        workdir: project.workdir,
        action: action as Parameters<typeof app.browserManager.execute>[0]["action"],
        args: req.body?.args,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(400).send({ error: message });
    }
  });
};
