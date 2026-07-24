import { FastifyPluginAsync } from "fastify";
import type { TaskType } from "@pi-web-ui/shared";

export const scheduledTasksRoutes: FastifyPluginAsync = async (app) => {
  // List all tasks
  app.get("/", async () => {
    return app.scheduledTasks.list();
  });

  // Create task
  app.post("/", async (req, reply) => {
    const body = req.body as {
      name: string;
      description?: string;
      cronExpression: string;
      taskType: TaskType;
      payload?: string;
      enabled?: boolean;
    };
    if (!body?.name) return reply.code(400).send({ error: "name required" });
    if (!body?.cronExpression) return reply.code(400).send({ error: "cronExpression required" });
    if (!body?.taskType) return reply.code(400).send({ error: "taskType required" });

    const task = app.scheduledTasks.create({
      name: body.name,
      description: body.description,
      cronExpression: body.cronExpression,
      taskType: body.taskType,
      payload: body.payload,
      enabled: body.enabled,
    });

    // Schedule the task if enabled
    if (task.enabled) {
      app.taskScheduler.upsertTask(task.id);
    }

    return reply.code(201).send(task);
  });

  // Get task by id
  app.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const task = app.scheduledTasks.findById(req.params.id);
    if (!task) return reply.code(404).send({ error: "not found" });
    return task;
  });

  // Update task
  app.put<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const body = req.body as {
      name?: string;
      description?: string;
      cronExpression?: string;
      taskType?: TaskType;
      payload?: string;
      enabled?: boolean;
    };
    const updated = app.scheduledTasks.update(req.params.id, body);
    if (!updated) return reply.code(404).send({ error: "not found" });

    // Re-schedule the task
    app.taskScheduler.upsertTask(updated.id);

    return updated;
  });

  // Delete task
  app.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const task = app.scheduledTasks.findById(req.params.id);
    if (!task) return reply.code(404).send({ error: "not found" });

    app.taskScheduler.removeTask(req.params.id);
    app.scheduledTasks.delete(req.params.id);
    return reply.code(204).send();
  });

  // Toggle enabled/disabled
  app.patch<{ Params: { id: string } }>("/:id/toggle", async (req, reply) => {
    const body = req.body as { enabled: boolean };
    if (typeof body?.enabled !== "boolean") {
      return reply.code(400).send({ error: "enabled (boolean) required" });
    }

    const updated = app.scheduledTasks.toggle(req.params.id, body.enabled);
    if (!updated) return reply.code(404).send({ error: "not found" });

    // Add or remove from scheduler
    app.taskScheduler.upsertTask(updated.id);

    return updated;
  });

  // Get task logs
  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>("/:id/logs", async (req, reply) => {
    const task = app.scheduledTasks.findById(req.params.id);
    if (!task) return reply.code(404).send({ error: "not found" });

    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50;
    return app.taskLogs.listByTaskId(req.params.id, limit);
  });

  // Manual trigger
  app.post<{ Params: { id: string } }>("/:id/run", async (req, reply) => {
    const task = app.scheduledTasks.findById(req.params.id);
    if (!task) return reply.code(404).send({ error: "not found" });

    // Fire and forget — don't await
    app.taskScheduler.executeNow(req.params.id).catch((err) => {
      app.log.error(`[scheduled-tasks] manual run failed: ${err}`);
    });

    return reply.code(202).send({ message: "task triggered" });
  });
};
