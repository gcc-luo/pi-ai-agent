import path from "node:path";
import Fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import { Config } from "./config.js";
import type Database from "better-sqlite3";

export interface AppDeps {
  config?: Config;
  [key: string]: unknown;
}

export async function buildApp(config: Config, deps?: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      transport: {
        targets: [
          { target: "pino-pretty", level: config.logLevel },
          { target: "pino/file", level: config.logLevel, options: { destination: config.logFile, mkdir: true } },
        ],
      },
    },
  });

  await app.register(cors, {
    origin(origin, callback) {
      // The server is a local desktop sidecar. Do not let arbitrary websites
      // read or mutate its unauthenticated local APIs through the browser.
      if (!origin) return callback(null, true);
      try {
        const url = new URL(origin);
        const localHost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
        const tauriHost = url.hostname === "tauri.localhost";
        callback(null, localHost || tauriHost);
      } catch {
        callback(null, false);
      }
    },
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });
  await app.register(websocket);
  // Multipart upload for skill .zip imports — 50MB ceiling covers any skill
  // bundle including supporting scripts/assets.
  await app.register(multipart, {
    limits: { fileSize: 50 * 1024 * 1024 },
  });

  if (deps) {
    for (const [k, v] of Object.entries(deps)) {
      (app as any)[k] = v;
    }
  }

  // Ensure config is accessible as app.config
  if (deps?.config) {
    (app as any).config = deps.config;
  }

  app.get("/healthz", async () => ({ ok: true }));

  return app;
}
