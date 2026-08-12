import { FastifyPluginAsync } from "fastify";
import fs from "node:fs/promises";
import path from "node:path";

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
    if (body?.embeddingModelId) {
      const model = app.models.findById(body.embeddingModelId);
      if (!model || model.modelType !== "embedding") {
        return reply.code(400).send({ error: "invalid_embedding_model" });
      }
    }
    const patch: Partial<{
      name: string; description: string | null; enabled: boolean;
      embeddingModelId: string | null;
    }> = {};
    if (body?.name !== undefined) patch.name = body.name.trim();
    if (body?.description !== undefined) patch.description = body.description;
    if (body?.enabled !== undefined) patch.enabled = body.enabled;
    if (body && Object.prototype.hasOwnProperty.call(body, "embeddingModelId")) {
      patch.embeddingModelId = body.embeddingModelId ?? null;
    }
    app.knowledgeBases.update(req.params.id, patch);
    if (patch.embeddingModelId !== undefined && patch.embeddingModelId !== kb.embeddingModelId) {
      for (const file of app.kbFiles.listByKb(req.params.id)) app.kbParseWorker.enqueue(file.id);
    }
    return app.knowledgeBases.findById(req.params.id);
  });

  app.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const kb = app.knowledgeBases.findById(req.params.id);
    if (!kb) return reply.code(404).send({ error: "not_found" });
    for (const file of app.kbFiles.listByKb(req.params.id)) app.kbChunks.deleteByFile(file.id);
    app.knowledgeBases.delete(req.params.id);
    const kbRoot = path.resolve(app.config.kbFilesDir);
    const target = path.resolve(kbRoot, req.params.id);
    if (target.startsWith(`${kbRoot}${path.sep}`)) {
      await fs.rm(target, { recursive: true, force: true });
    }
    return reply.code(204).send();
  });
};
