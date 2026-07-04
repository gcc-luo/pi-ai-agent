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

  app.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const p = app.projects.findById(req.params.id);
    if (!p) return reply.code(404).send({ error: "not found" });
    app.projects.delete(req.params.id);
    return reply.code(204).send();
  });
};
