import type { FastifyPluginAsync } from "fastify";
import { browserCallNeedsConfirmation } from "../browser/browser-permissions.js";
import {
  BROWSER_PLUGIN_ID,
  COMPUTER_PLUGIN_ID,
} from "../plugins/plugin-manager.js";
import {
  computerRisk,
  type ComputerAction,
} from "../computer/computer-session-manager.js";
import { WECHAT_FILE_TRANSFER_PLUGIN_ID } from "../channels/wechat-file-transfer-service.js";

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
    if (
      typeof token !== "string"
      || !app.processManager.validatePluginToken(
        req.params.sessionId,
        req.params.pluginId,
        token,
      )
    ) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const session = app.sessions.findById(req.params.sessionId);
    if (!session) return reply.code(404).send({ error: "session not found" });
    if (req.params.pluginId === WECHAT_FILE_TRANSFER_PLUGIN_ID) {
      if (!app.processManager.isPluginActive(session.id, WECHAT_FILE_TRANSFER_PLUGIN_ID)) {
        return reply.code(409).send({ error: "微信文件发送工具当前不可用" });
      }
      if (req.body?.action !== "sendFiles") {
        return reply.code(400).send({ error: "invalid wechat file transfer action" });
      }
      const filePaths = req.body?.args?.filePaths;
      if (!Array.isArray(filePaths) || filePaths.some((filePath) => typeof filePath !== "string")) {
        return reply.code(400).send({ error: "filePaths must be a string array" });
      }
      const controller = new AbortController();
      const abort = () => controller.abort();
      const disconnect = () => { if (!reply.raw.writableEnded) controller.abort(); };
      req.raw.once("aborted", abort);
      reply.raw.once("close", disconnect);
      const safeFileNames = (filePaths as string[]).map((filePath) =>
        filePath.replace(/\\/g, "/").split("/").pop() ?? "",
      );
      try {
        const approved = await app.authorization.authorize({
          sessionId: session.id,
          source: "plugin",
          pluginId: WECHAT_FILE_TRANSFER_PLUGIN_ID,
          toolName: "send_file_to_wechat",
          action: "sendFiles",
          risk: "sensitive",
          reason: "即将通过微信发送本地文件。",
          context: { files: safeFileNames },
          signal: controller.signal,
        });
        if (!approved) {
          return {
            ok: false,
            denied: true,
            requiresConfirmation: true,
            message: "用户未确认或确认已超时，文件未发送。",
          };
        }
        if (
          controller.signal.aborted
          || !app.processManager.validatePluginToken(session.id, WECHAT_FILE_TRANSFER_PLUGIN_ID, token)
          || !app.processManager.isPluginActive(session.id, WECHAT_FILE_TRANSFER_PLUGIN_ID)
        ) {
          return reply.code(403).send({ error: "微信文件发送授权已撤销，文件未发送。" });
        }
        return await app.wechatFileTransfers.sendFiles(session.id, filePaths as string[]);
      } catch (error) {
        return reply.code(409).send({
          error: error instanceof Error ? error.message : "微信文件发送失败",
        });
      } finally {
        req.raw.off("aborted", abort);
        reply.raw.off("close", disconnect);
      }
    }
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
    const disconnect = () => { if (!reply.raw.writableEnded) controller.abort(); };
    reply.raw.once("close", disconnect);
    let auditRisk: "normal" | "sensitive" | "destructive" = "normal";
    let auditApproved = false;
    let auditDetails: Record<string, unknown> = {};
    try {
      if (req.params.pluginId === BROWSER_PLUGIN_ID) {
        if (action === "complete") {
          const risk = app.browserManager.report(session.id, String(args.toolCallId), { isError: args.isError === true, details: args.details as Record<string, unknown> });
          if (!risk) return reply.code(409).send({ error: "browser call was not authorized or already completed" });
          app.plugins.appendAudit({ pluginId: BROWSER_PLUGIN_ID, sessionId: session.id,
            action: "agent_browser", risk, approved: true, success: args.isError !== true,
            details: { toolCallId: args.toolCallId, phase: "complete" } });
          return { ok: true };
        }
        if (action !== "authorize") return reply.code(410).send({ error: "旧浏览器执行 API 已移除，请通过 agent_browser 扩展操作。" });
        if (typeof args.toolCallId !== "string" || !args.toolCallId || !["agent_browser", "agent_browser_web_search"].includes(String(args.toolName))) {
          return reply.code(400).send({ error: "invalid native browser call" });
        }
        const params = args.params;
        if (!params || typeof params !== "object" || Array.isArray(params)) return reply.code(400).send({ error: "params must be an object" });
        const needsConfirmation = args.toolName !== "agent_browser_web_search" && browserCallNeedsConfirmation(params as Record<string, unknown>);
        const review = JSON.stringify(params);
        if (needsConfirmation && review.length > 12000) return reply.code(400).send({ error: "浏览器调用过长，无法完整展示确认内容，请拆分为较小调用。" });
        auditRisk = needsConfirmation ? "sensitive" : "normal";
        let approved = await app.authorization.authorize({
          sessionId: session.id,
          source: "plugin",
          pluginId: BROWSER_PLUGIN_ID,
          toolName: String(args.toolName),
          action: "agent_browser",
          risk: auditRisk,
          reason: needsConfirmation
            ? "该浏览器调用包含交互、脚本或会话配置，确认将执行本次完整调用。"
            : "该浏览器调用将访问网页内容。",
          context: { target: review },
          signal: controller.signal,
        });
        approved = approved && !controller.signal.aborted
          && app.processManager.validatePluginToken(session.id, BROWSER_PLUGIN_ID, token)
          && app.pluginManager.activeForSession(session.id).includes(BROWSER_PLUGIN_ID);
        auditApproved = approved;
        app.plugins.appendAudit({ pluginId: BROWSER_PLUGIN_ID, sessionId: session.id,
          action: "agent_browser", risk: auditRisk, approved, success: approved,
          details: { toolCallId: args.toolCallId, phase: "authorize" } });
        if (approved) app.browserManager.begin(session.id, args.toolCallId, auditRisk, args.toolName === "agent_browser");
        return { approved };
      }
      if (req.params.pluginId === COMPUTER_PLUGIN_ID) {
        if (!COMPUTER_ACTIONS.has(action as ComputerAction)) {
          return reply.code(400).send({ error: "invalid computer action" });
        }
        const risk = computerRisk(action as ComputerAction, args);
        auditRisk = risk.level;
        const computerState = app.computerManager.sessionStatus(session.id);
        auditDetails = {
          reason: risk.reason,
          intent: args.intent,
          windowId: computerState?.targetWindow,
        };
        let approved = await app.authorization.authorize({
          sessionId: session.id,
          source: "plugin",
          pluginId: COMPUTER_PLUGIN_ID,
          toolName: `computer.${action}`,
          action,
          risk: risk.level,
          reason: risk.reason ?? "该桌面操作需要用户确认",
          intent: typeof args.intent === "string" ? args.intent : undefined,
          context: { windowId: computerState?.targetWindow ?? undefined },
          signal: controller.signal,
        });
        approved = approved && !controller.signal.aborted
          && app.processManager.validatePluginToken(session.id, COMPUTER_PLUGIN_ID, token)
          && app.pluginManager.activeForSession(session.id).includes(COMPUTER_PLUGIN_ID);
        auditApproved = approved;
        if (!approved) {
          app.plugins.appendAudit({
            pluginId: COMPUTER_PLUGIN_ID,
            sessionId: session.id,
            action,
            risk: risk.level,
            approved: false,
            success: false,
            details: auditDetails,
          });
          return {
            ok: false,
            denied: true,
            requiresConfirmation: true,
            riskReason: risk.reason,
            message: "用户未确认或确认已超时，操作未执行。",
          };
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
          risk: auditRisk,
          approved: auditApproved,
          success: true,
          details: auditDetails,
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
        risk: auditRisk,
        approved: auditApproved,
        success: false,
        details: { ...auditDetails, error: message },
      });
      return reply.code(400).send({
        error: message,
      });
    } finally {
      req.raw.off("aborted", abort);
      reply.raw.off("close", disconnect);
    }
  });
};
