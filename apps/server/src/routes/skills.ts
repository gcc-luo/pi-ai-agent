import { FastifyPluginAsync } from "fastify";

interface CreateBody {
  name: string;
  description: string;
  body: string;
}

export const skillsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async () => {
    return app.skills.list();
  });

  app.post("/", async (req, reply) => {
    const body = req.body as CreateBody;
    if (!body?.name || !body?.description || !body?.body) {
      return reply.code(400).send({ error: "name, description, and body are required" });
    }
    try {
      const dto = app.skills.import({ name: body.name, description: body.description, body: body.body });
      return reply.code(201).send(dto);
    } catch (e: any) {
      return reply.code(400).send({ error: e.message ?? "invalid skill" });
    }
  });

  // Upload a .zip skills bundle. Multipart form with a single `file` field.
  // Validates the archive shape and returns imported skill names + per-skill
  // errors so the client can surface a friendly message.
  app.post("/import-zip", async (req, reply) => {
    const file = await req.file();
    if (!file) {
      return reply.code(400).send({ error: "no_file" });
    }
    const original = file.filename ?? "skill.zip";
    if (!original.toLowerCase().endsWith(".zip")) {
      return reply.code(400).send({ error: "zip_only" });
    }
    const buf = await file.toBuffer();
    try {
      const result = app.skills.importZip(buf);
      return reply.code(201).send(result);
    } catch (e: any) {
      const code = e.message ?? "invalid_zip";
      return reply.code(400).send({ error: code });
    }
  });

  app.delete<{ Params: { name: string } }>("/:name", async (req, reply) => {
    const { name } = req.params;
    try {
      app.skills.uninstall(name);
      return reply.code(204).send();
    } catch (e: any) {
      if (e.message === "not found") return reply.code(404).send({ error: "not found" });
      return reply.code(400).send({ error: e.message ?? "invalid skill" });
    }
  });
};
