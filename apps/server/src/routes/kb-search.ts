import { FastifyPluginAsync } from "fastify";
import { resolveSearchScopes } from "../kb/search-scopes.js";

export const kbSearchRoutes: FastifyPluginAsync = async (app) => {
  app.post("/kb-search", async (req, reply) => {
    const body = req.body as {
      query?: string;
      kbIds?: string[];
      fileIds?: string[];
      scopes?: Array<{ kbId: string; fileIds?: string[] | null }>;
      limit?: number;
    } | null;

    if (!body?.query?.trim()) return reply.code(400).send({ error: "query_required" });
    const requestedScopes = body.scopes?.length
      ? body.scopes
      : body.kbIds?.map((kbId) => ({ kbId, fileIds: body.fileIds }));
    if (!requestedScopes?.length) return reply.code(400).send({ error: "kb_ids_required" });

    const scopes = resolveSearchScopes(app, requestedScopes);

    const result = await app.kbSearch.search({
      query: body.query.trim(), scopes,
      limit: body.limit ?? 8,
    });

    return result;
  });
};
