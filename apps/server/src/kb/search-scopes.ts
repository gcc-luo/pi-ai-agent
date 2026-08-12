import type { FastifyInstance } from "fastify";
import type { SearchScope } from "./search-service.js";
import { embeddingModelVersion } from "./embedding-client.js";

export interface RequestedKbScope {
  kbId: string;
  fileIds?: string[] | null;
}

export function resolveSearchScopes(
  app: FastifyInstance,
  requested: RequestedKbScope[],
): SearchScope[] {
  const seen = new Set<string>();
  const scopes: SearchScope[] = [];
  for (const item of requested) {
    if (seen.has(item.kbId)) continue;
    seen.add(item.kbId);
    const kb = app.knowledgeBases.findById(item.kbId);
    if (!kb?.enabled) continue;

    let embeddingModel: SearchScope["embeddingModel"];
    if (kb.embeddingModelId) {
      const model = app.models.findById(kb.embeddingModelId);
      if (model?.modelType === "embedding" && model.apiBaseUrl && model.apiKey) {
        embeddingModel = {
          apiBaseUrl: model.apiBaseUrl,
          apiKey: model.apiKey,
          modelId: model.id,
          modelVersion: embeddingModelVersion(model.apiBaseUrl, model.id),
        };
      }
    }

    scopes.push({ kbId: item.kbId, fileIds: item.fileIds, embeddingModel });
  }
  return scopes;
}
