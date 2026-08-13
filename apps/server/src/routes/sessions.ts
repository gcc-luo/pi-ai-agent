import { FastifyPluginAsync } from "fastify";
import { restorePiHistory } from "../agent/pi-history.js";
import { syncPiTranscript } from "../agent/pi-transcript-sync.js";
import { piSessionDirectory, latestPiSessionFile } from "../agent/pi-session-store.js";

export const sessionsRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Params: { projectId: string } }>("/projects/:projectId/sessions", async (req, reply) => {
    const project = app.projects.findById(req.params.projectId);
    if (!project) return reply.code(404).send({ error: "project not found" });
    const body = (req.body ?? {}) as { parentId?: string; title?: string };
    const s = app.sessions.create({
      projectId: project.id,
      parentId: body.parentId,
      title: body.title,
    });
    return reply.code(201).send(s);
  });

  app.get<{ Params: { projectId: string } }>("/projects/:projectId/sessions", async (req) => {
    return app.sessions.listByProject(req.params.projectId);
  });

  app.get<{ Params: { id: string } }>("/sessions/:id", async (req, reply) => {
    const s = app.sessions.findById(req.params.id);
    if (!s) return reply.code(404).send({ error: "not found" });
    return s;
  });

  app.put<{ Params: { id: string } }>("/sessions/:id", async (req, reply) => {
    const body = (req.body ?? {}) as { title?: string; expertId?: string | null };
    const cur = app.sessions.findById(req.params.id);
    if (!cur) return reply.code(404).send({ error: "not found" });

    if ("title" in body) {
      const title = body.title?.trim();
      if (!title) return reply.code(400).send({ error: "title required" });
      app.sessions.update(req.params.id, { title });
    }

    if ("expertId" in body) {
      if (body.expertId !== null && typeof body.expertId !== "string") {
        return reply.code(400).send({ error: "expertId must be a string or null" });
      }
      if (body.expertId && !app.experts.findById(body.expertId)) {
        return reply.code(404).send({ error: "expert not found" });
      }
      app.sessions.setExpert(req.params.id, body.expertId ?? null);
    }

    if (!("title" in body) && !("expertId" in body)) {
      return reply.code(400).send({ error: "title or expertId required" });
    }
    return app.sessions.findById(req.params.id);
  });

  app.get<{ Params: { id: string } }>("/sessions/:id/messages", async (req, reply) => {
    const s = app.sessions.findById(req.params.id);
    if (!s) return reply.code(404).send({ error: "not found" });
    const piSessionDir = piSessionDirectory(app.config.piSessionRootDir, s.id);
    syncPiTranscript({
      sessionId: s.id,
      sessionDir: piSessionDir,
      repository: app.messages,
    });
    const messages = app.messages.listBySession(req.params.id);
    const project = app.projects.findById(s.projectId);
    // Legacy sessions created before the shared Pi directory existed can use
    // the old best-effort recovery once. New sessions always use the explicit
    // per-Web-session JSONL above, never a guessed global Pi transcript.
    if (project && !latestPiSessionFile(piSessionDir)) {
      restorePiHistory({ workdir: project.workdir, createdAt: s.createdAt, messages, repository: app.messages });
    }
    return app.messages.listBySession(req.params.id);
  });

  app.delete<{ Params: { id: string } }>("/sessions/:id", async (req, reply) => {
    const s = app.sessions.findById(req.params.id);
    if (!s) return reply.code(404).send({ error: "not found" });
    app.pluginPermissions?.cancelSession(req.params.id);
    app.processManager.revokePluginToken(req.params.id);
    app.sessionStates.get(req.params.id)?.process.kill();
    app.sessionStates.delete(req.params.id);
    if (app.pluginManager) await app.pluginManager.closeSession(req.params.id);
    else if (app.browserManager) await app.browserManager.close(req.params.id);
    app.sessions.delete(req.params.id);
    return reply.code(204).send();
  });
};
