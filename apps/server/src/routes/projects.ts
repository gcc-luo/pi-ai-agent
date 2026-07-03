import { FastifyPluginAsync } from "fastify";
import { ulid } from "../util/ulid.js";

export const projectsRoutes: FastifyPluginAsync = async (app) => {
  app.post("/", async (req, reply) => {
    const body = req.body as { name: string; description?: string };
    if (!body?.name) return reply.code(400).send({ error: "name required" });
    const id = ulid();
    const workdir = app.workdirs.path(id);
    app.workdirs.create(id);
    const p = app.projects.create({ id, name: body.name, workdir, description: body.description });
    return reply.code(201).send(p);
  });

  app.get("/", async () => app.projects.list());

  app.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const p = app.projects.findById(req.params.id);
    if (!p) return reply.code(404).send({ error: "not found" });
    return p;
  });

  app.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const p = app.projects.findById(req.params.id);
    if (!p) return reply.code(404).send({ error: "not found" });
    app.projects.delete(req.params.id);
    try { app.workdirs.delete(req.params.id); } catch {}
    return reply.code(204).send();
  });
};
