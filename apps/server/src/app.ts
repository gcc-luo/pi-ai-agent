import Fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { Config } from "./config.js";

export async function buildApp(config: Config): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: config.logLevel, transport: { target: "pino-pretty" } },
  });

  await app.register(cors, { origin: true, credentials: true });
  await app.register(websocket);

  app.get("/healthz", async () => ({ ok: true }));

  return app;
}
