import { FastifyPluginAsync } from "fastify";

export const kbSearchRoutes: FastifyPluginAsync = async (app) => {
  app.post("/kb-search", async (req, reply) => {
    const body = req.body as {
      query?: string;
      kbIds?: string[];
      fileIds?: string[];
      limit?: number;
    } | null;

    if (!body?.query?.trim()) return reply.code(400).send({ error: "query_required" });
    if (!body.kbIds?.length) return reply.code(400).send({ error: "kb_ids_required" });

    const result = app.kbSearch.search({
      query: body.query.trim(),
      kbIds: body.kbIds,
      fileIds: body.fileIds,
      limit: body.limit ?? 8,
    });

    return result;
  });
};
