import { FastifyPluginAsync } from "fastify";
import {
  SkillSearchResult,
  SkillContentPreview,
  SkillSearchMode,
  SkillStoreInstallRequest,
} from "@pi-web-ui/shared";

export const skillStoreRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { q: string; mode?: string; limit?: string } }>("/search", async (req, reply) => {
    const q = (req.query.q ?? "").trim();
    if (!q) return reply.code(400).send({ error: "q is required" });
    const mode: SkillSearchMode = req.query.mode === "ai" ? "ai" : "keyword";
    const limit = Math.min(Math.max(Number(req.query.limit ?? 20) || 20, 1), 50);
    try {
      const result = await app.skillStore.search(q, mode, limit);
      return reply.send(result);
    } catch (e: any) {
      app.log.error({ err: e?.message }, "skill-store search failed");
      return reply.code(502).send({ error: e?.message ?? "search failed" });
    }
  });

  app.post<{ Body: SkillSearchResult }>("/preview", async (req, reply) => {
    const skill = req.body;
    if (!skill?.id || !skill?.provider) {
      return reply.code(400).send({ error: "skill with id and provider is required" });
    }
    try {
      const preview: SkillContentPreview = await app.skillStore.preview(skill);
      return reply.send(preview);
    } catch (e: any) {
      app.log.error({ err: e?.message }, "skill-store preview failed");
      return reply.code(502).send({ error: e?.message ?? "preview failed" });
    }
  });

  app.post<{ Body: SkillStoreInstallRequest }>("/install", async (req, reply) => {
    const body = req.body;
    if (!body?.skill?.id) {
      return reply.code(400).send({ error: "skill is required" });
    }
    try {
      const result = await app.skillStore.install(body.skill, body.localName);
      return reply.code(201).send(result);
    } catch (e: any) {
      app.log.error({ err: e?.message }, "skill-store install failed");
      const status = e?.message === "invalid skill name" || /invalid skill name/.test(e?.message ?? "") ? 400 : 502;
      return reply.code(status).send({ error: e?.message ?? "install failed" });
    }
  });
};
