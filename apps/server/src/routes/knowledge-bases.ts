import { FastifyPluginAsync } from "fastify";

export const knowledgeBasesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async () => app.knowledgeBases.list());

  app.post("/", async (req, reply) => {
    const body = req.body as { name?: string; description?: string; embeddingModelId?: string | null } | null;
    if (!body?.name?.trim()) return reply.code(400).send({ error: "name_required" });
    const name = body.name.trim();
    if (name.length > 100) return reply.code(400).send({ error: "name_too_long" });
    const existing = app.knowledgeBases.findByName(name);
    if (existing) return reply.code(409).send({ error: "name_exists" });
    const kb = app.knowledgeBases.create({
      name,
      description: body.description?.trim() || undefined,
      embeddingModelId: body.embeddingModelId ?? null,
    });
    return reply.code(201).send(kb);
  });

  app.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const kb = app.knowledgeBases.findById(req.params.id);
    if (!kb) return reply.code(404).send({ error: "not_found" });
    return kb;
  });

  app.put<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const body = req.body as { name?: string; description?: string | null; enabled?: boolean; embeddingModelId?: string | null } | null;
    const kb = app.knowledgeBases.findById(req.params.id);
    if (!kb) return reply.code(404).send({ error: "not_found" });
    if (body?.name !== undefined) {
      const name = body.name.trim();
      if (!name) return reply.code(400).send({ error: "name_required" });
      if (name.length > 100) return reply.code(400).send({ error: "name_too_long" });
      const dup = app.knowledgeBases.findByName(name);
      if (dup && dup.id !== kb.id) return reply.code(409).send({ error: "name_exists" });
    }
    app.knowledgeBases.update(req.params.id, {
      name: body?.name?.trim(),
      description: body?.description,
      enabled: body?.enabled,
      embeddingModelId: body?.embeddingModelId ?? null,
    });
    return app.knowledgeBases.findById(req.params.id);
  });

  app.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const kb = app.knowledgeBases.findById(req.params.id);
    if (!kb) return reply.code(404).send({ error: "not_found" });
    app.knowledgeBases.delete(req.params.id);
    return reply.code(204).send();
  });
};
