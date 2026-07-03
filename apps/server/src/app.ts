import Fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { Config } from "./config.js";
import type Database from "better-sqlite3";

export interface AppDeps {
  [key: string]: unknown;
}

export async function buildApp(config: Config, deps?: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: config.logLevel, transport: { target: "pino-pretty" } },
  });

  await app.register(cors, { origin: true, credentials: true });
  await app.register(websocket);

  if (deps) {
    for (const [k, v] of Object.entries(deps)) {
      (app as any)[k] = v;
    }
  }

  app.get("/healthz", async () => ({ ok: true }));

  return app;
}
