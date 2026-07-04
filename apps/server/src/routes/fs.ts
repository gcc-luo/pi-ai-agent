import { FastifyPluginAsync } from "fastify";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const fsRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { path?: string } }>("/browse", async (req, reply) => {
    const input = req.query.path ?? os.homedir();
    const abs = path.resolve(input);

    let stat: fs.Stats;
    try {
      stat = fs.statSync(abs);
    } catch {
      return reply.code(400).send({ error: "path not found" });
    }
    if (!stat.isDirectory()) {
      return reply.code(400).send({ error: "not a directory" });
    }

    const entries = fs.readdirSync(abs, { withFileTypes: true });
    const directories = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => ({ name: e.name, path: path.join(abs, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      currentPath: abs,
      parentPath: path.dirname(abs),
      directories,
    };
  });
};
