import type { FastifyPluginAsync } from "fastify";

const ACTIONS = new Set([
  "open",
  "navigate",
  "snapshot",
  "click",
  "fill",
  "upload",
  "select",
  "press",
  "hover",
  "scroll",
  "wait",
  "tabs",
  "screenshot",
  "console_errors",
  "network_errors",
  "close",
]);

export const browserRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string } }>("/sessions/:id/browser", async (req, reply) => {
    const session = app.sessions.findById(req.params.id);
    if (!session) return reply.code(404).send({ error: "session not found" });
    const enabled = app.pluginManager.activeForSession(session.id).includes("browser-use");
    return app.browserManager.status(session.id, enabled);
  });

  app.put<{
    Params: { id: string };
    Body: { enabled?: boolean };
  }>("/sessions/:id/browser", async (req, reply) => {
    const session = app.sessions.findById(req.params.id);
    if (!session) return reply.code(404).send({ error: "session not found" });
    if (typeof req.body?.enabled !== "boolean") {
      return reply.code(400).send({ error: "enabled must be a boolean" });
    }
    app.processManager.revokePluginToken(session.id);
    app.pluginPermissions.cancelSession(session.id);
    const stopped = await app.processManager.stopAndWait(session.id);
    if (!stopped) {
      return reply.code(409).send({ error: "agent process is still stopping; retry shortly" });
    }
    app.sessionStates.delete(session.id);
    const selected = app.plugins.selectedForSession(session.id);
    const next = req.body.enabled
      ? [...new Set([...selected, "browser-use"])]
      : selected.filter((id) => id !== "browser-use");

    if (!req.body.enabled) {
      app.pluginManager.setSessionPlugins(session.id, next);
      await app.browserManager.close(session.id);
      return app.browserManager.status(session.id, false);
    }

    try {
      app.pluginManager.setSessionPlugins(session.id, next);
    } catch (error) {
      return reply.code(409).send({
        error: error instanceof Error ? error.message : String(error),
      });
    }
    // Browser runtime remains lazy and starts on the first browser tool call.
    return app.browserManager.status(session.id, true);
  });

  app.post<{
    Params: { id: string };
    Body: { action?: string; args?: Record<string, unknown> };
  }>("/internal/browser/:id/action", async (req, reply) => {
    const token = req.headers["x-pi-plugin-token"] ?? req.headers["x-pi-browser-token"];
    if (
      typeof token !== "string"
      || !app.processManager.validatePluginToken(req.params.id, "browser-use", token)
    ) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const session = app.sessions.findById(req.params.id);
    if (!session) return reply.code(404).send({ error: "session not found" });
    if (!app.pluginManager.activeForSession(session.id).includes("browser-use")) {
      return reply.code(409).send({ error: "browser capability is disabled for this session" });
    }
    const project = app.projects.findById(session.projectId);
    if (!project) return reply.code(404).send({ error: "project not found" });
    const action = req.body?.action;
    if (!action || !ACTIONS.has(action)) {
      return reply.code(400).send({ error: "invalid browser action" });
    }
    const args = { ...(req.body?.args ?? {}) };
    delete args.userConfirmed;
    const controller = new AbortController();
    const abort = () => controller.abort();
    req.raw.once("aborted", abort);
    let auditRisk: "normal" | "sensitive" = "normal";
    let auditApproved = false;
    let auditDetails: Record<string, unknown> = { compatibilityRoute: true };
    try {
      let result = await app.browserManager.execute({
        sessionId: session.id,
        workdir: project.workdir,
        action: action as Parameters<typeof app.browserManager.execute>[0]["action"],
        args,
        signal: controller.signal,
      });
      const requiresConfirmation = result.requiresConfirmation === true;
      auditRisk = requiresConfirmation ? "sensitive" : "normal";
      let approved = !requiresConfirmation;
      auditApproved = approved;
      auditDetails = {
        compatibilityRoute: true,
        requiresConfirmation,
        riskReason: result.riskReason,
        url: result.url,
        target: result.target,
        files: result.files,
      };
      if (requiresConfirmation) {
        const state = app.sessionStates.get(session.id);
        approved = state
          ? await app.pluginPermissions.request({
              sessionId: session.id,
              pluginId: "browser-use",
              action,
              reason: typeof result.riskReason === "string"
                ? result.riskReason
                : "该网页操作可能产生外部或不可逆影响",
              context: {
                url: typeof result.url === "string" ? result.url : undefined,
                target: typeof result.target === "string" ? result.target : undefined,
                files: Array.isArray(result.files)
                  ? result.files.filter((file): file is string => typeof file === "string")
                  : undefined,
              },
              send: state.send,
              signal: controller.signal,
            })
          : false;
        auditApproved = approved;
        if (approved) {
          result = await app.browserManager.execute({
            sessionId: session.id,
            workdir: project.workdir,
            action: action as Parameters<typeof app.browserManager.execute>[0]["action"],
            args: { ...args, userConfirmed: true },
            signal: controller.signal,
          });
        } else {
          result = {
            ...result,
            denied: true,
            message: state
              ? "用户未确认或确认已超时，操作未执行。"
              : "当前渠道无法完成交互式权限确认，操作未执行。",
          };
        }
      }
      app.plugins.appendAudit({
        pluginId: "browser-use",
        sessionId: session.id,
        action,
        risk: auditRisk,
        approved: auditApproved,
        success: approved && result.ok !== false,
        details: auditDetails,
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      app.plugins.appendAudit({
        pluginId: "browser-use",
        sessionId: session.id,
        action,
        risk: auditRisk,
        approved: auditApproved,
        success: false,
        details: { ...auditDetails, error: message },
      });
      return reply.code(400).send({ error: message });
    } finally {
      req.raw.off("aborted", abort);
    }
  });
};
