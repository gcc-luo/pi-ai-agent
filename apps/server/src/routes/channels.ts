import { FastifyPluginAsync } from "fastify";
import type { ChannelType } from "@pi-web-ui/shared";
import { CHANNEL_DESCRIPTORS } from "../channels/descriptors.js";
import { getRegistry, rebuildAdapters, sendToChannel, startChannelListeners } from "../channels/registry.js";
import { getWeChatWorker } from "../channels/wechat-worker.js";

export const channelsRoutes: FastifyPluginAsync = async (app) => {
  async function refreshAdapters() {
    await rebuildAdapters(app.channels.list());
    // Connecting the vendor long connection may take a few seconds. Saving a
    // configuration should stay responsive; connection failures are retained
    // in the registry status and adapter logs.
    void startChannelListeners().catch((error) => {
      app.log.error({ err: error }, "failed to start channel listeners after configuration update");
    });
  }
  // Static channel descriptors (card metadata + config schema)
  app.get("/descriptors", async () => CHANNEL_DESCRIPTORS);

  // List persisted channel configs
  app.get("/configs", async () => app.channels.list());

  // Sender-to-session bindings for the two long-connection enterprise bots.
  app.get<{ Params: { id: string } }>("/configs/:id/conversations", async (req, reply) => {
    const config = app.channels.findById(req.params.id);
    if (!config) return reply.code(404).send({ error: "not found" });
    return app.channelConversations.list(config.id).flatMap((binding) => {
      const session = app.sessions.findById(binding.sessionId);
      if (!session) return [];
      return [{ userId: binding.userId, sessionId: binding.sessionId, title: session.title, updatedAt: binding.updatedAt }];
    });
  });

  // Create a new channel config
  app.post("/configs", async (req, reply) => {
    const body = req.body as {
      type: ChannelType;
      name: string;
      enabled?: boolean;
      config: Record<string, unknown>;
    };
    if (!body?.type) return reply.code(400).send({ error: "type required" });
    if (!body?.name) return reply.code(400).send({ error: "name required" });
    if (!body?.config) return reply.code(400).send({ error: "config required" });

    const created = app.channels.create({
      type: body.type,
      name: body.name,
      enabled: body.enabled,
      config: body.config,
    });
    await refreshAdapters();
    return reply.code(201).send(created);
  });

  // Update an existing config
  app.put<{ Params: { id: string } }>("/configs/:id", async (req, reply) => {
    const body = req.body as {
      name?: string;
      enabled?: boolean;
      config?: Record<string, unknown>;
    };
    const updated = app.channels.update(req.params.id, body);
    if (!updated) return reply.code(404).send({ error: "not found" });
    await refreshAdapters();
    return updated;
  });

  // Delete a config
  app.delete<{ Params: { id: string } }>("/configs/:id", async (req, reply) => {
    const existing = app.channels.findById(req.params.id);
    if (!existing) return reply.code(404).send({ error: "not found" });
    app.channels.delete(req.params.id);
    await refreshAdapters();
    return reply.code(204).send();
  });

  // Send a test message
  app.post<{ Params: { id: string } }>("/configs/:id/test", async (req, reply) => {
    const body = (req.body as { text?: string; recipient?: string }) ?? {};
    const cfg = app.channels.findById(req.params.id);
    if (!cfg) return reply.code(404).send({ error: "not found" });
    const result = await sendToChannel(
      req.params.id,
      body.text ?? "Pi 频道测试消息 ✅",
      body.recipient,
    );
    return result;
  });

  // Adapter registry status — useful for debugging load errors
  app.get("/status", async () => {
    const reg = getRegistry();
    return { adapters: reg.list(), errors: reg.getErrors() };
  });

  // ─── WeChat channel (QR login flow, separate from webhook-style configs) ───
  app.post("/wechat/login", async () => {
    await getWeChatWorker().startLogin();
    return { ok: true };
  });

  app.get("/wechat/status", async () => {
    return getWeChatWorker().getStatus();
  });

  app.post("/wechat/logout", async () => {
    getWeChatWorker().stop();
    return { ok: true };
  });

  // Each wxid is intentionally isolated in its own Pi conversation. The
  // drawer shows these bindings so operators can understand the routing.
  app.get("/wechat/conversations", async () => {
    const config = app.channels.list().find((channel) => channel.type === "wechat");
    if (!config) return [];
    return app.channelConversations.list(config.id).flatMap((binding) => {
      const session = app.sessions.findById(binding.sessionId);
      if (!session) return [];
      return [{ userId: binding.userId, sessionId: binding.sessionId, title: session.title, updatedAt: binding.updatedAt }];
    });
  });

  app.post("/wechat/test", async (req, reply) => {
    const { userId, text } = (req.body as { userId?: string; text?: string }) ?? {};
    if (!userId) {
      reply.code(400);
      return { ok: false, error: "userId (wxid) is required" };
    }
    return await getWeChatWorker().sendTest(userId, text ?? "Pi 频道测试消息 ✅");
  });
};
