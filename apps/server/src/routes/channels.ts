import { FastifyPluginAsync } from "fastify";
import type { ChannelType } from "@pi-web-ui/shared";
import { CHANNEL_DESCRIPTORS } from "../channels/descriptors.js";
import { getRegistry, rebuildAdapters, sendToChannel } from "../channels/registry.js";

export const channelsRoutes: FastifyPluginAsync = async (app) => {
  // Static channel descriptors (card metadata + config schema)
  app.get("/descriptors", async () => CHANNEL_DESCRIPTORS);

  // List persisted channel configs
  app.get("/configs", async () => app.channels.list());

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
    await rebuildAdapters(app.channels.list());
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
    await rebuildAdapters(app.channels.list());
    return updated;
  });

  // Delete a config
  app.delete<{ Params: { id: string } }>("/configs/:id", async (req, reply) => {
    const existing = app.channels.findById(req.params.id);
    if (!existing) return reply.code(404).send({ error: "not found" });
    app.channels.delete(req.params.id);
    await rebuildAdapters(app.channels.list());
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
};
