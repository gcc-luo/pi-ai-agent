import type { FastifyPluginAsync } from "fastify";
import {
  BROWSER_PLUGIN_ID,
  COMPUTER_PLUGIN_ID,
} from "../plugins/plugin-manager.js";
import {
  computerRisk,
  type ComputerAction,
} from "../computer/computer-session-manager.js";

const BROWSER_ACTIONS = new Set([
  "open", "navigate", "snapshot", "click", "fill", "select", "press",
  "hover", "scroll", "wait", "tabs", "screenshot", "console_errors",
  "network_errors", "close",
]);

const COMPUTER_ACTIONS = new Set<ComputerAction>([
  "screenshot", "list_windows", "focus_window", "click", "double_click",
  "type", "key", "scroll", "drag", "wait", "get_cursor_position",
]);

export const pluginsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/plugins", async () => app.pluginManager.list());

  app.put<{
    Params: { id: string };
    Body: { enabled?: boolean; settings?: Record<string, unknown> };
  }>("/plugins/:id", async (req, reply) => {
    if (typeof req.body?.enabled !== "boolean" && req.body?.settings === undefined) {
      return reply.code(400).send({ error: "enabled or settings is required" });
    }
    const current = app.pluginManager.find(req.params.id);
    if (!current) return reply.code(404).send({ error: "plugin not found" });
    const enabled = req.body.enabled ?? current.enabled;
    if (!enabled) {
      const sessionIds = app.pluginManager.sessionsSelecting(req.params.id);
      // Persist the deny decision and revoke credentials before asynchronous
      // process teardown, so no request can win a disable race.
      app.pluginManager.setEnabled(req.params.id, false, req.body.settings);
      app.processManager.revokePluginTokens(sessionIds);
      for (const sessionId of sessionIds) app.pluginPermissions.cancelSession(sessionId);
      const stopped = await Promise.all(
        sessionIds.map((sessionId) => app.processManager.stopAndWait(sessionId)),
      );
      stopped.forEach((didStop, index) => {
        if (didStop) app.sessionStates.delete(sessionIds[index]!);
      });
      try {
        await app.pluginManager.disableRuntime(req.params.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        app.plugins.update(req.params.id, { lastError: message });
      }
      if (stopped.some((didStop) => !didStop)) {
        app.plugins.update(req.params.id, {
          lastError: "插件已禁用，但部分 Agent 进程未在超时内退出",
        });
      }
      return app.pluginManager.find(req.params.id);
    }
    return app.pluginManager.setEnabled(req.params.id, enabled, req.body.settings);
  });

  app.get<{ Params: { id: string } }>("/sessions/:id/plugins", async (req, reply) => {
    const session = app.sessions.findById(req.params.id);
    if (!session) return reply.code(404).send({ error: "session not found" });
    return {
      selectedPluginIds: app.pluginManager.activeForSession(session.id),
      availablePlugins: app.pluginManager.enabledAvailable(),
    };
  });

  app.put<{
    Params: { id: string };
    Body: { pluginIds?: string[] };
  }>("/sessions/:id/plugins", async (req, reply) => {
    const session = app.sessions.findById(req.params.id);
    if (!session) return reply.code(404).send({ error: "session not found" });
    if (!Array.isArray(req.body?.pluginIds) || req.body.pluginIds.some((id) => typeof id !== "string")) {
      return reply.code(400).send({ error: "pluginIds must be a string array" });
    }
    const previous = app.plugins.selectedForSession(session.id);
    try {
      app.processManager.revokePluginToken(session.id);
      app.pluginPermissions.cancelSession(session.id);
      const stopped = await app.processManager.stopAndWait(session.id);
      if (!stopped) return reply.code(409).send({ error: "agent process is still stopping" });
      app.sessionStates.delete(session.id);
      const selectedPluginIds = app.pluginManager.setSessionPlugins(session.id, req.body.pluginIds);
      const removed = previous.filter((id) => !selectedPluginIds.includes(id));
      await Promise.all(removed.map((id) => app.pluginManager.closeSessionPlugin(session.id, id)));
      return {
        session: app.sessions.findById(session.id),
        selectedPluginIds,
        availablePlugins: app.pluginManager.enabledAvailable(),
      };
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.post<{
    Params: { sessionId: string; pluginId: string };
    Body: { action?: string; args?: Record<string, unknown> };
  }>("/internal/plugins/:sessionId/:pluginId/action", async (req, reply) => {
    const token = req.headers["x-pi-plugin-token"];
    if (typeof token !== "string" || !app.processManager.validatePluginToken(req.params.sessionId, token)) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const session = app.sessions.findById(req.params.sessionId);
    if (!session) return reply.code(404).send({ error: "session not found" });
    if (!app.pluginManager.activeForSession(session.id).includes(req.params.pluginId)) {
      return reply.code(409).send({ error: "plugin is not enabled and selected for this session" });
    }
    const project = app.projects.findById(session.projectId);
    if (!project) return reply.code(404).send({ error: "project not found" });
    const action = req.body?.action;
    const args = { ...(req.body?.args ?? {}) };
    // Authorization is never accepted from model-authored tool arguments.
    delete args.userConfirmed;
    if (!action) return reply.code(400).send({ error: "action is required" });

    const controller = new AbortController();
    const abort = () => controller.abort();
    req.raw.once("aborted", abort);
    try {
      if (req.params.pluginId === BROWSER_PLUGIN_ID) {
        if (!BROWSER_ACTIONS.has(action)) return reply.code(400).send({ error: "invalid browser action" });
        let result = await app.browserManager.execute({
          sessionId: session.id,
          workdir: project.workdir,
          action: action as Parameters<typeof app.browserManager.execute>[0]["action"],
          args,
          signal: controller.signal,
        });
        const requiresConfirmation = result.requiresConfirmation === true;
        let approved = !requiresConfirmation;
        if (requiresConfirmation) {
          const state = app.sessionStates.get(session.id);
          approved = state
            ? await app.pluginPermissions.request({
                sessionId: session.id,
                pluginId: BROWSER_PLUGIN_ID,
                action,
                reason: typeof result.riskReason === "string"
                  ? result.riskReason
                  : "该网页操作可能产生外部或不可逆影响",
                send: state.send,
                signal: controller.signal,
              })
            : false;
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
          pluginId: BROWSER_PLUGIN_ID,
          sessionId: session.id,
          action,
          risk: requiresConfirmation ? "sensitive" : "normal",
          approved,
          success: approved && result.ok !== false,
          details: { requiresConfirmation },
        });
        app.plugins.update(BROWSER_PLUGIN_ID, { lastError: null });
        return result;
      }
      if (req.params.pluginId === COMPUTER_PLUGIN_ID) {
        if (!COMPUTER_ACTIONS.has(action as ComputerAction)) {
          return reply.code(400).send({ error: "invalid computer action" });
        }
        const risk = computerRisk(action as ComputerAction, args);
        let approved = risk.level === "normal";
        if (!approved) {
          const state = app.sessionStates.get(session.id);
          approved = state
            ? await app.pluginPermissions.request({
                sessionId: session.id,
                pluginId: COMPUTER_PLUGIN_ID,
                action,
                reason: risk.reason ?? "该桌面操作需要用户确认",
                intent: typeof args.intent === "string" ? args.intent : undefined,
                send: state.send,
                signal: controller.signal,
              })
            : false;
          if (!approved) {
            app.plugins.appendAudit({
              pluginId: COMPUTER_PLUGIN_ID,
              sessionId: session.id,
              action,
              risk: risk.level,
              approved: false,
              success: false,
              details: { reason: risk.reason, intent: args.intent },
            });
            return {
              ok: false,
              denied: true,
              requiresConfirmation: true,
              riskReason: risk.reason,
              message: state
                ? "用户未确认或确认已超时，操作未执行。"
                : "当前渠道无法完成交互式权限确认，操作未执行。",
            };
          }
        }
        const result = await app.computerManager.execute({
          sessionId: session.id,
          workdir: project.workdir,
          action: action as ComputerAction,
          args,
          signal: controller.signal,
        });
        app.plugins.appendAudit({
          pluginId: COMPUTER_PLUGIN_ID,
          sessionId: session.id,
          action,
          risk: risk.level,
          approved,
          success: true,
          details: { intent: args.intent },
        });
        app.plugins.update(COMPUTER_PLUGIN_ID, { lastError: null });
        return result;
      }
      return reply.code(404).send({ error: "plugin runtime not found" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (app.pluginManager.find(req.params.pluginId)) {
        app.plugins.update(req.params.pluginId, { lastError: message });
      }
      app.plugins.appendAudit({
        pluginId: req.params.pluginId,
        sessionId: session.id,
        action,
        risk: "normal",
        approved: false,
        success: false,
        details: { error: message },
      });
      return reply.code(400).send({
        error: message,
      });
    } finally {
      req.raw.off("aborted", abort);
    }
  });
};
