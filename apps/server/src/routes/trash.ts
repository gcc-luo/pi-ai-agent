import type { FastifyPluginAsync } from "fastify";
import type { TrashItemDto } from "@pi-web-ui/shared";

export const trashRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/trash - List all deleted items (projects + sessions)
  app.get("/", async () => {
    const deletedProjects = app.projects.listDeleted();
    const deletedSessions = app.sessions.listDeleted();

    const items: TrashItemDto[] = [];

    for (const p of deletedProjects) {
      items.push({
        kind: "project",
        id: p.id,
        name: p.name,
        subtitle: p.workdir,
        deletedAt: p.deletedAt!,
        projectId: p.id,
      });
    }

    for (const s of deletedSessions) {
      // Resolve parent project name for subtitle
      const projectRow = app.db.prepare(
        "SELECT name FROM projects WHERE id = ?"
      ).get(s.projectId) as { name: string } | undefined;

      items.push({
        kind: "session",
        id: s.id,
        name: s.title ?? "未命名会话",
        subtitle: projectRow?.name ?? null,
        deletedAt: s.deletedAt!,
        projectId: s.projectId,
      });
    }

    // Sort by deletedAt descending (most recently deleted first)
    items.sort((a, b) => b.deletedAt - a.deletedAt);
    return items;
  });

  // POST /api/trash/restore - Restore an item
  app.post("/restore", async (req, reply) => {
    const body = req.body as { kind: "project" | "session"; id: string };
    if (!body?.kind || !body?.id) {
      return reply.code(400).send({ error: "kind and id required" });
    }

    if (body.kind === "project") {
      app.projects.restore(body.id);
    } else if (body.kind === "session") {
      app.sessions.restore(body.id);
    } else {
      return reply.code(400).send({ error: "invalid kind" });
    }

    return reply.code(204).send();
  });

  // POST /api/trash/destroy - Permanently delete an item
  app.post("/destroy", async (req, reply) => {
    const body = req.body as { kind: "project" | "session"; id: string };
    if (!body?.kind || !body?.id) {
      return reply.code(400).send({ error: "kind and id required" });
    }

    if (body.kind === "project") {
      const projectSessionIds = (app.db.prepare("SELECT id FROM sessions WHERE project_id = ?").all(body.id) as { id: string }[])
        .map((session) => session.id);
      app.processManager.revokePluginTokens(projectSessionIds);
      for (const sessionId of projectSessionIds) app.pluginPermissions?.cancelSession(sessionId);
      // Kill any running agent processes for sessions under this project
      for (const state of app.sessionStates.values()) {
        if (state.process.projectId !== body.id) continue;
        try { state.process.kill(); } catch (e) {
          req.log.warn({ err: e }, "failed to kill agent during permanent delete");
        }
        app.sessionStates.delete(state.sessionId);
      }
      for (const proc of app.tuiProcessManager.values()) {
        if (proc.projectId === body.id) app.tuiProcessManager.stop(proc.sessionId);
      }
      await Promise.allSettled(projectSessionIds.map((sessionId) =>
        app.pluginManager?.closeSession(sessionId)
          ?? app.browserManager?.close(sessionId)
          ?? Promise.resolve(),
      ));
      for (const sessionId of projectSessionIds) app.tuiProcessManager.removeSessionHistory(sessionId);
      app.projects.destroyPermanently(body.id);
    } else if (body.kind === "session") {
      // Kill running agent process for this session
      app.pluginPermissions?.cancelSession(body.id);
      app.processManager.revokePluginToken(body.id);
      const state = app.sessionStates.get(body.id);
      if (state) {
        state.process.kill();
        app.sessionStates.delete(body.id);
      }
      app.tuiProcessManager.stop(body.id);
      if (app.pluginManager) await app.pluginManager.closeSession(body.id);
      else if (app.browserManager) await app.browserManager.close(body.id);
      app.tuiProcessManager.removeSessionHistory(body.id);
      app.sessions.destroyPermanently(body.id);
    } else {
      return reply.code(400).send({ error: "invalid kind" });
    }

    return reply.code(204).send();
  });

  // POST /api/trash/empty - Empty all trash
  app.post("/empty", async (req, reply) => {
    // Kill all running processes for trashed items
    const deletedProjects = app.projects.listDeleted();
    const deletedSessions = app.sessions.listDeleted();

    for (const p of deletedProjects) {
      const projectSessionIds = (app.db.prepare("SELECT id FROM sessions WHERE project_id = ?").all(p.id) as { id: string }[])
        .map((session) => session.id);
      app.processManager.revokePluginTokens(projectSessionIds);
      for (const sessionId of projectSessionIds) app.pluginPermissions?.cancelSession(sessionId);
      for (const state of app.sessionStates.values()) {
        if (state.process.projectId !== p.id) continue;
        try { state.process.kill(); } catch {}
        app.sessionStates.delete(state.sessionId);
      }
      for (const proc of app.tuiProcessManager.values()) {
        if (proc.projectId === p.id) app.tuiProcessManager.stop(proc.sessionId);
      }
      await Promise.allSettled(projectSessionIds.map((sessionId) =>
        app.pluginManager?.closeSession(sessionId)
          ?? app.browserManager?.close(sessionId)
          ?? Promise.resolve(),
      ));
      for (const sessionId of projectSessionIds) app.tuiProcessManager.removeSessionHistory(sessionId);
      app.projects.destroyPermanently(p.id);
    }

    for (const s of deletedSessions) {
      // Skip sessions already destroyed as part of a project above
      if (deletedProjects.some(p => p.id === s.projectId)) continue;
      app.pluginPermissions?.cancelSession(s.id);
      app.processManager.revokePluginToken(s.id);
      const state = app.sessionStates.get(s.id);
      if (state) {
        state.process.kill();
        app.sessionStates.delete(s.id);
      }
      app.tuiProcessManager.stop(s.id);
      if (app.pluginManager) await app.pluginManager.closeSession(s.id);
      else if (app.browserManager) await app.browserManager.close(s.id);
      app.tuiProcessManager.removeSessionHistory(s.id);
      app.sessions.destroyPermanently(s.id);
    }

    return reply.code(204).send();
  });
};
