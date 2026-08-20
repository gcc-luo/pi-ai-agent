import Fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import { Config } from "./config.js";
import { isLoopbackHost } from "./config.js";

export interface AppDeps {
  config?: Config;
  [key: string]: unknown;
}

export async function buildApp(config: Config, deps?: AppDeps): Promise<FastifyInstance> {
  const metrics = { startedAt: Date.now(), requests: 0, responses: 0, errors: 0, active: 0 };
  const app = Fastify({
    bodyLimit: 10 * 1024 * 1024,
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
  app.addHook("onRequest", async () => {
    metrics.requests++;
    metrics.active++;
  });
  app.addHook("onResponse", async (_req, reply) => {
    metrics.responses++;
    metrics.active = Math.max(0, metrics.active - 1);
    if (reply.statusCode >= 500) metrics.errors++;
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
    allowedHeaders: ["content-type", "authorization", "x-pi-web-ui-token"],
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });
  await app.register(websocket, {
    options: {
      handleProtocols(protocols) {
        return protocols.has("pi-web-ui") ? "pi-web-ui" : false;
      },
    },
  });
  // Multipart upload for skill .zip imports — 50MB ceiling covers any skill
  // bundle including supporting scripts/assets.
  await app.register(multipart, {
    limits: { fileSize: 50 * 1024 * 1024 },
  });

  if (!isLoopbackHost(config.host) && !config.authToken) {
    throw new Error("非回环地址启动必须配置 PI_WEB_UI_AUTH_TOKEN");
  }

  if (config.authToken) {
    app.addHook("onRequest", async (req, reply) => {
      if (req.url === "/healthz") return;
      const authorization = req.headers.authorization;
      const bearer = typeof authorization === "string" && authorization.startsWith("Bearer ")
        ? authorization.slice("Bearer ".length)
        : undefined;
      const headerToken = req.headers["x-pi-web-ui-token"];
      let token = bearer ?? (typeof headerToken === "string" ? headerToken : undefined);

      // Browsers cannot set custom headers during a WebSocket upgrade, so the
      // WebSocket client sends the deployment token as a subprotocol. The
      // server selects the non-secret protocol marker below.
      if (!token && req.url.startsWith("/ws/")) {
        const protocols = req.headers["sec-websocket-protocol"];
        const values = typeof protocols === "string" ? protocols.split(",").map((value) => value.trim()) : [];
        token = values.find((value) => value !== "pi-web-ui");
      }

      if (token !== config.authToken) {
        return reply.code(401).send({ error: "unauthorized" });
      }
    });
  }

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
  app.get("/metrics", async () => ({
    uptimeMs: Date.now() - metrics.startedAt,
    requests: metrics.requests,
    responses: metrics.responses,
    errors: metrics.errors,
    activeRequests: metrics.active,
  }));

  return app;
}
