import { FastifyPluginAsync } from "fastify";
import type { ModelDto } from "@pi-web-ui/shared";

export const configRoutes: FastifyPluginAsync = async (app) => {
  app.get("/config", async () => {
    const models: ModelDto[] = app.models.list();
    const defaultModel = models.find((m: ModelDto) => m.isDefault);
    return {
      provider: defaultModel?.provider ?? app.config.piProvider ?? null,
      model: defaultModel?.id ?? app.config.piModel ?? null,
      models: models.map((m: ModelDto) => ({ id: m.id, provider: m.provider, label: m.label })),
    };
  });

  app.put<{ Body: { model?: string } }>("/config", async (req, reply) => {
    const body = req.body as { model?: string };
    if (body.model) {
      const m = app.models.findById(body.model);
      if (!m) return reply.code(404).send({ error: "model not found" });
      app.models.setDefault(body.model);
    }
    const models: ModelDto[] = app.models.list();
    const defaultModel = models.find((m: ModelDto) => m.isDefault);
    return {
      provider: defaultModel?.provider ?? app.config.piProvider ?? null,
      model: defaultModel?.id ?? app.config.piModel ?? null,
      models: models.map((m: ModelDto) => ({ id: m.id, provider: m.provider, label: m.label })),
    };
  });
};
