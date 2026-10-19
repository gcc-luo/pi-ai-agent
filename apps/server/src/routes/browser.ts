import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { isAllowedLocalOrigin } from "../security/local-origin.js";

export const browserRoutes: FastifyPluginAsync = async (app) => {
  const requireSession = (sessionId: string) => app.sessions.findById(sessionId);
  const rejectForeignOrigin = (origin: string | undefined, reply: FastifyReply): boolean => {
    if (isAllowedLocalOrigin(origin)) return false;
    reply.code(403).send({ error: "origin not allowed" });
    return true;
  };

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

  app.post<{ Params: { id: string } }>("/sessions/:id/browser-panel/open", async (req, reply) => {
    if (rejectForeignOrigin(req.headers.origin, reply)) return;
    const session = requireSession(req.params.id);
    if (!session) return reply.code(404).send({ error: "session not found" });
    await app.browserManager.ensurePanelSession(session.id);
    return { status: "open" };
  });

  app.post<{ Params: { id: string } }>("/sessions/:id/browser-panel/close", async (req, reply) => {
    if (rejectForeignOrigin(req.headers.origin, reply)) return;
    const session = requireSession(req.params.id);
    if (!session) return reply.code(404).send({ error: "session not found" });
    await app.browserManager.closePanelSession(session.id);
    return { status: "closed" };
  });

  app.post<{
    Params: { id: string };
    Body: { url?: unknown };
  }>("/sessions/:id/browser-panel/navigate", async (req, reply) => {
    if (rejectForeignOrigin(req.headers.origin, reply)) return;
    const session = requireSession(req.params.id);
    if (!session) return reply.code(404).send({ error: "session not found" });
    const url = req.body?.url;
    if (typeof url !== "string" || url.length > 4_096 || !isAllowedPanelUrl(url)) {
      return reply.code(400).send({ error: "url must use http, https, or about:blank" });
    }
    await app.browserManager.navigate(session.id, url);
    return { status: "open" };
  });

  for (const action of ["back", "forward", "reload"] as const) {
    app.post<{ Params: { id: string } }>(`/sessions/:id/browser-panel/${action}`, async (req, reply) => {
      if (rejectForeignOrigin(req.headers.origin, reply)) return;
      const session = requireSession(req.params.id);
      if (!session) return reply.code(404).send({ error: "session not found" });
      await app.browserManager[action](session.id);
      return { status: "open" };
    });
  }

  // Keep the old URL explicit rather than silently starting a second browser backend.
  app.post("/internal/browser/:id/action", async (_req, reply) =>
    reply.code(410).send({ error: "请通过 agent_browser 扩展操作浏览器。" }));
};

function isAllowedPanelUrl(value: string): boolean {
  if (value === "about:blank") return true;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
