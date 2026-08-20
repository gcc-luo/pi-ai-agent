import path from "node:path";
import { FastifyPluginAsync } from "fastify";
import { createDatabaseBackup, listDatabaseBackups, validateDatabaseBackup } from "../db/backup.js";

export const backupsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async () => listDatabaseBackups(app.config.backupDir));

  app.post("/", async (_req, reply) => {
    const backup = await createDatabaseBackup(app.db, app.config.backupDir);
    return reply.code(201).send(backup);
  });

  app.post<{ Params: { name: string } }>("/:name/validate", async (req, reply) => {
    const name = path.basename(req.params.name);
    if (name !== req.params.name || !/^pi-web-ui-\d{8}T\d{6}Z\.sqlite$/.test(name)) {
      return reply.code(400).send({ error: "invalid backup name" });
    }
    const result = await validateDatabaseBackup(path.join(app.config.backupDir, name));
    return result.ok ? result : reply.code(422).send(result);
  });
};
