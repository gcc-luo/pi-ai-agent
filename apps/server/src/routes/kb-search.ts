import { FastifyPluginAsync } from "fastify";
import { EmbeddingModelConfig } from "../kb/embedding-client.js";

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

    // Find embedding model config from the first KB that has one
    let embeddingModel: EmbeddingModelConfig | undefined;
    for (const kbId of body.kbIds) {
      const kb = app.knowledgeBases.findById(kbId);
      if (kb?.embeddingModelId) {
        const model = app.models.findById(kb.embeddingModelId);
        if (model && model.modelType === "embedding" && model.apiBaseUrl && model.apiKey) {
          embeddingModel = {
            apiBaseUrl: model.apiBaseUrl,
            apiKey: model.apiKey,
            modelId: model.id,
          };
          break;
        }
      }
    }

    const result = await app.kbSearch.search({
      query: body.query.trim(),
      kbIds: body.kbIds,
      fileIds: body.fileIds,
      limit: body.limit ?? 8,
      embeddingModel,
    });

    return result;
  });
};
