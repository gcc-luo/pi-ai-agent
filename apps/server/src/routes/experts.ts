import { FastifyPluginAsync } from "fastify";
import type { ExpertCategory } from "@pi-web-ui/shared";

export const expertsRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { category?: string } }>("/", async (req) => {
    const category = req.query.category as ExpertCategory | undefined;
    return app.experts.list(category);
  });

  app.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const expert = app.experts.findById(req.params.id);
    if (!expert) return reply.code(404).send({ error: "not found" });
    return expert;
  });

  app.post("/", async (req, reply) => {
    const body = req.body as {
      name: string; icon?: string; category: ExpertCategory;
      description: string; systemPrompt: string; tags?: string[];
    };
    if (!body?.name) return reply.code(400).send({ error: "name required" });
    if (!body?.category) return reply.code(400).send({ error: "category required" });
    if (!body?.description) return reply.code(400).send({ error: "description required" });
    if (!body?.systemPrompt) return reply.code(400).send({ error: "systemPrompt required" });

    const expert = app.experts.create({
      name: body.name,
      icon: body.icon,
      category: body.category,
      description: body.description,
      systemPrompt: body.systemPrompt,
      tags: body.tags,
    });
    return reply.code(201).send(expert);
  });

  app.put<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const body = req.body as {
      name?: string; icon?: string; category?: ExpertCategory;
      description?: string; systemPrompt?: string; tags?: string[]; sortOrder?: number;
    };
    const updated = app.experts.update(req.params.id, body);
    if (!updated) return reply.code(404).send({ error: "not found" });
    return updated;
  });

  app.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const expert = app.experts.findById(req.params.id);
    if (!expert) return reply.code(404).send({ error: "not found" });
    if (expert.isPreset) return reply.code(403).send({ error: "cannot delete preset expert" });

    app.experts.delete(req.params.id);
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string } }>("/:id/summon", async (req, reply) => {
    const body = req.body as { projectId: string };
    if (!body?.projectId) return reply.code(400).send({ error: "projectId required" });

    const expert = app.experts.findById(req.params.id);
    if (!expert) return reply.code(404).send({ error: "expert not found" });

    const project = app.projects.findById(body.projectId);
    if (!project) return reply.code(404).send({ error: "project not found" });

    const session = app.sessions.create({
      projectId: body.projectId,
      title: `与${expert.name}对话`,
      expertId: expert.id,
    });

    return reply.code(201).send(session);
  });
};
