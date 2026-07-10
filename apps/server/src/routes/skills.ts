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

  app.delete<{ Params: { name: string } }>("/:name", async (req, reply) => {
    const { name } = req.params;
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
      return reply.code(400).send({ error: "invalid skill name" });
    }
    try {
      app.skills.uninstall(name);
      return reply.code(204).send();
    } catch (e: any) {
      if (e.message === "not found") return reply.code(404).send({ error: "not found" });
      return reply.code(400).send({ error: e.message ?? "invalid skill" });
    }
  });
};
