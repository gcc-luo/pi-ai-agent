import fs from "node:fs";
import path from "node:path";
import { FastifyPluginAsync } from "fastify";
import { ulid } from "../util/ulid.js";

export const projectsRoutes: FastifyPluginAsync = async (app) => {
  app.post("/", async (req, reply) => {
    const body = req.body as { name: string; workdir: string; description?: string };
    if (!body?.name) return reply.code(400).send({ error: "name required" });
    if (!body?.workdir) return reply.code(400).send({ error: "workdir required" });

    const absWorkdir = path.resolve(body.workdir);
    if (!fs.existsSync(absWorkdir)) return reply.code(400).send({ error: "workdir does not exist" });
    const stat = fs.statSync(absWorkdir);
    if (!stat.isDirectory()) return reply.code(400).send({ error: "workdir is not a directory" });

    const id = ulid();
    const p = app.projects.create({ id, name: body.name, workdir: absWorkdir, description: body.description });
    return reply.code(201).send(p);
  });

  app.get("/", async () => app.projects.list());

  app.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const p = app.projects.findById(req.params.id);
    if (!p) return reply.code(404).send({ error: "not found" });
    return p;
  });

  app.put<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const body = req.body as { name?: string };
    const name = body?.name?.trim();
    if (!name) return reply.code(400).send({ error: "name required" });
    const cur = app.projects.findById(req.params.id);
    if (!cur) return reply.code(404).send({ error: "not found" });
    app.projects.update(req.params.id, { name });
    return app.projects.findById(req.params.id);
  });

  app.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const cur = app.projects.findById(req.params.id);
    if (!cur) return reply.code(404).send({ error: "not found" });
    const projectId = req.params.id;
    const projectSessionIds = app.sessions.listByProject(projectId).map((session) => session.id);
    app.processManager.revokePluginTokens(projectSessionIds);
    for (const sessionId of projectSessionIds) app.pluginPermissions?.cancelSession(sessionId);
    for (const state of app.sessionStates.values()) {
      if (state.process.projectId !== projectId) continue;
      try {
        state.process.kill();
      } catch (e) {
        req.log.warn({ err: e, sessionId: state.sessionId }, "failed to kill agent process during project delete");
      }
      app.sessionStates.delete(state.sessionId);
    }
    await Promise.allSettled(projectSessionIds.map((sessionId) =>
      app.pluginManager?.closeSession(sessionId)
        ?? app.browserManager?.close(sessionId)
        ?? Promise.resolve(),
    ));
    app.projects.delete(projectId);
    return reply.code(204).send();
  });
};
