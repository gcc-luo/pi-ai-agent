import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import WebSocket from "ws";
import { isAllowedLocalOrigin } from "../security/local-origin.js";

const MAX_TERMINAL_MESSAGE_BYTES = 8 * 1024;
const MAX_SOCKET_BUFFERED_BYTES = 2 * 1024 * 1024;

type TerminalInput =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "close" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function toBuffer(data: WebSocket.RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

function parseInput(value: unknown): TerminalInput | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;
  if (value.type === "input") {
    if (!hasOnlyKeys(value, ["type", "data"]) || typeof value.data !== "string") return null;
    return { type: "input", data: value.data };
  }
  if (value.type === "resize") {
    if (!hasOnlyKeys(value, ["type", "cols", "rows"])) return null;
    if (!Number.isInteger(value.cols) || Number(value.cols) < 20 || Number(value.cols) > 300) return null;
    if (!Number.isInteger(value.rows) || Number(value.rows) < 5 || Number(value.rows) > 100) return null;
    return { type: "resize", cols: Number(value.cols), rows: Number(value.rows) };
  }
  if (value.type === "close" && hasOnlyKeys(value, ["type"])) return { type: "close" };
  return null;
}

function closeSocket(socket: WebSocket, code: number, reason: string): void {
  if (socket.readyState === WebSocket.OPEN) {
    try { socket.close(code, reason); } catch { try { socket.terminate(); } catch {} }
  }
}

export const terminalWsRoutes: FastifyPluginAsync = async (app) => {
  const prepareTerminal = async (
    request: FastifyRequest<{ Params: { sessionId: string } }>,
    reply: FastifyReply,
  ) => {
    if (!isAllowedLocalOrigin(request.headers.origin)) {
      return reply.code(403).send({ error: "origin not allowed" });
    }
    const session = app.sessions.findById(request.params.sessionId);
    if (!session) return reply.code(404).send({ error: "session not found" });
    const project = app.projects.findById(session.projectId);
    if (!project) return reply.code(404).send({ error: "project not found" });
    try {
      app.terminalManager.ensure(session.id, project.workdir);
    } catch (error) {
      request.log.warn({ sessionId: session.id, err: error }, "failed to start terminal PTY");
      return reply.code(503).send({ error: "terminal unavailable" });
    }
  };

  app.get<{ Params: { sessionId: string } }>(
    "/ws/terminal/:sessionId",
    { websocket: true, preValidation: prepareTerminal },
    (client, request) => {
      const sessionId = request.params.sessionId;
      const receiver = (client as unknown as { _receiver?: { _maxPayload: number } })._receiver;
      if (receiver) receiver._maxPayload = MAX_TERMINAL_MESSAGE_BYTES;

      let finished = false;
      let unsubscribe: () => void = () => {};
      const cleanup = () => {
        if (finished) return;
        finished = true;
        client.off("message", onMessage);
        client.off("error", onError);
        client.off("close", onClose);
        unsubscribe();
      };
      const sendExit = (event: { type: "exit"; exitCode: number; signal: number }) => {
        if (client.readyState !== WebSocket.OPEN) return;
        const raw = JSON.stringify(event);
        if (client.bufferedAmount + Buffer.byteLength(raw) > MAX_SOCKET_BUFFERED_BYTES) {
          closeSocket(client, 1013, "terminal client is too slow");
          cleanup();
          return;
        }
        client.send(raw, { binary: false });
      };
      const sendData = (data: Buffer) => {
        if (client.readyState !== WebSocket.OPEN) return;
        if (client.bufferedAmount + data.byteLength > MAX_SOCKET_BUFFERED_BYTES) {
          closeSocket(client, 1013, "terminal client is too slow");
          cleanup();
          return;
        }
        client.send(data, { binary: true });
      };
      const onClose = () => cleanup();
      const onServerClose = () => {
        cleanup();
        closeSocket(client, 1001, "terminal closed");
      };
      const onError = (error: Error) => {
        request.log.warn({ sessionId, err: error }, "terminal panel WebSocket failed");
        cleanup();
      };
      const onMessage = (rawData: WebSocket.RawData, isBinary: boolean) => {
        const raw = toBuffer(rawData);
        if (raw.byteLength > MAX_TERMINAL_MESSAGE_BYTES) {
          closeSocket(client, 1009, "terminal input too large");
          cleanup();
          return;
        }
        if (isBinary) {
          closeSocket(client, 1008, "binary terminal input is not supported");
          cleanup();
          return;
        }

        let value: unknown;
        try { value = JSON.parse(raw.toString("utf8")); }
        catch {
          closeSocket(client, 1008, "invalid terminal input JSON");
          cleanup();
          return;
        }
        const message = parseInput(value);
        if (!message) {
          closeSocket(client, 1008, "unsupported terminal input");
          cleanup();
          return;
        }

        try {
          if (message.type === "input") app.terminalManager.write(sessionId, message.data);
          else if (message.type === "resize") app.terminalManager.resize(sessionId, message.cols, message.rows);
          else {
            cleanup();
            void app.terminalManager.close(sessionId).then(() => closeSocket(client, 1000, "terminal closed"));
          }
        } catch (error) {
          request.log.warn({ sessionId, err: error }, "terminal input handling failed");
          closeSocket(client, 1011, "terminal unavailable");
          cleanup();
        }
      };

      try {
        unsubscribe = app.terminalManager.subscribe(sessionId, sendData, sendExit, onServerClose);
      } catch (error) {
        request.log.warn({ sessionId, err: error }, "failed to attach terminal client");
        closeSocket(client, 1011, "terminal unavailable");
        return;
      }
      client.on("message", onMessage);
      client.once("error", onError);
      client.once("close", onClose);
    },
  );
};
