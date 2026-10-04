import type { FastifyPluginAsync } from "fastify";
import { classifyCoreToolRisk } from "../authorization/core-tool-risk.js";
import { abortOnDisconnect } from "./request-abort.js";

const CORE_TOOL_NAMES = new Set(["bash", "read", "write", "edit", "grep", "find", "ls"]);

export const authorizationRoutes: FastifyPluginAsync = async (app) => {
  app.post<{
    Params: { sessionId: string };
    Body: { toolCallId?: string; toolName?: string; input?: Record<string, unknown> };
  }>("/internal/authorization/:sessionId/check", async (req, reply) => {
    const token = req.headers["x-pi-authorization-token"];
    if (
      typeof token !== "string"
      || !app.processManager.validateAuthorizationToken(req.params.sessionId, token)
    ) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const session = app.sessions.findById(req.params.sessionId);
    if (!session) return reply.code(404).send({ error: "session not found" });
    const proc = app.processManager.get(session.id);
    if (!proc || proc.status !== "active") {
      return reply.code(409).send({ error: "agent process is not active" });
    }
    const project = app.projects.findById(session.projectId);
    if (!project) return reply.code(404).send({ error: "project not found" });
    const { toolCallId, toolName, input } = req.body ?? {};
    if (
      typeof toolCallId !== "string"
      || !toolCallId
      || typeof toolName !== "string"
      || !CORE_TOOL_NAMES.has(toolName)
      || !input
      || typeof input !== "object"
      || Array.isArray(input)
    ) {
      return reply.code(400).send({ error: "invalid core tool authorization request" });
    }

    const lifecycle = abortOnDisconnect(req.raw, reply.raw);
    try {
      const classification = classifyCoreToolRisk({ toolName, input, workdir: project.workdir });
      const approved = await app.authorization.authorize({
        sessionId: session.id,
        source: "core_tool",
        toolName,
        action: "execute",
        risk: classification.risk,
        reason: classification.reason,
        context: { target: coreToolApprovalTarget(toolName, input) },
        signal: lifecycle.signal,
      });
      const currentProc = app.processManager.get(session.id);
      const stillAuthorized = !lifecycle.signal.aborted
        && app.processManager.validateAuthorizationToken(session.id, token)
        && currentProc?.status === "active";
      if (!approved || !stillAuthorized) {
        return {
          approved: false,
          reason: stillAuthorized ? "用户未批准，工具未执行。" : "授权已取消或会话进程已停止，工具未执行。",
        };
      }
      return { approved: true };
    } finally {
      lifecycle.dispose();
    }
  });
};

function coreToolApprovalTarget(toolName: string, input: Record<string, unknown>): string {
  const candidate = toolName === "bash"
    ? input.command ?? input.cmd
    : input.path ?? input.filePath ?? input.file_path;
  if (typeof candidate !== "string" || !candidate.trim()) return ".";
  return candidate.slice(0, 1_000);
}
