import { FastifyPluginAsync } from "fastify";
import { restorePiHistory } from "../agent/pi-history.js";

export const sessionsRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Params: { projectId: string } }>("/projects/:projectId/sessions", async (req, reply) => {
    const project = app.projects.findById(req.params.projectId);
    if (!project) return reply.code(404).send({ error: "project not found" });
    const body = (req.body ?? {}) as { parentId?: string; title?: string };
    const s = app.sessions.create({
      projectId: project.id,
      parentId: body.parentId,
      title: body.title,
    });
    return reply.code(201).send(s);
  });

  app.get<{ Params: { projectId: string } }>("/projects/:projectId/sessions", async (req) => {
    return app.sessions.listByProject(req.params.projectId);
  });

  app.get<{ Params: { id: string } }>("/sessions/:id", async (req, reply) => {
    const s = app.sessions.findById(req.params.id);
    if (!s) return reply.code(404).send({ error: "not found" });
    return s;
  });

  app.put<{ Params: { id: string } }>("/sessions/:id", async (req, reply) => {
    const body = (req.body ?? {}) as { title?: string };
    const title = body.title?.trim();
    if (!title) return reply.code(400).send({ error: "title required" });
    const cur = app.sessions.findById(req.params.id);
    if (!cur) return reply.code(404).send({ error: "not found" });
    app.sessions.update(req.params.id, { title });
    return app.sessions.findById(req.params.id);
  });

  app.get<{ Params: { id: string } }>("/sessions/:id/messages", async (req, reply) => {
    const s = app.sessions.findById(req.params.id);
    if (!s) return reply.code(404).send({ error: "not found" });
    const messages = app.messages.listBySession(req.params.id);
    const project = app.projects.findById(s.projectId);
    if (project) {
      restorePiHistory({ workdir: project.workdir, createdAt: s.createdAt, messages, repository: app.messages });
    }
    return app.messages.listBySession(req.params.id);
  });

  app.delete<{ Params: { id: string } }>("/sessions/:id", async (req, reply) => {
    const s = app.sessions.findById(req.params.id);
    if (!s) return reply.code(404).send({ error: "not found" });
    app.sessionStates.get(req.params.id)?.process.kill();
    app.sessionStates.delete(req.params.id);
    app.sessions.delete(req.params.id);
    return reply.code(204).send();
  });
};
