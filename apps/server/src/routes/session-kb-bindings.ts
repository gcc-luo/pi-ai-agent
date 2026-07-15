import { FastifyPluginAsync } from "fastify";

const MAX_BINDINGS_PER_SESSION = 10;

export const sessionKbBindingsRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { sessionId: string } }>("/sessions/:sessionId/kb-bindings", async (req, reply) => {
    return app.kbBindings.listBySession(req.params.sessionId);
  });

  app.put<{ Params: { sessionId: string } }>("/sessions/:sessionId/kb-bindings", async (req, reply) => {
    const body = req.body as { kbId: string; fileFilter?: string[] | null }[] | null;
    if (!Array.isArray(body)) return reply.code(400).send({ error: "invalid_body" });

    if (body.length > MAX_BINDINGS_PER_SESSION) {
      return reply.code(400).send({ error: "too_many_bindings", limit: MAX_BINDINGS_PER_SESSION });
    }

    // Validate KBs exist
    for (const b of body) {
      if (!b.kbId) return reply.code(400).send({ error: "kb_id_required" });
      const kb = app.knowledgeBases.findById(b.kbId);
      if (!kb) return reply.code(404).send({ error: "kb_not_found", kbId: b.kbId });
    }

    app.kbBindings.replaceAll(req.params.sessionId, body.map((b) => ({
      kbId: b.kbId,
      fileFilter: b.fileFilter ?? null,
    })));

    return app.kbBindings.listBySession(req.params.sessionId);
  });
};
