import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import WebSocket from "ws";
import { isAllowedLocalOrigin } from "../security/local-origin.js";

const MAX_CLIENT_MESSAGE_BYTES = 64 * 1024;
const MAX_PROXY_BUFFERED_BYTES = 2 * 1024 * 1024;
const MAX_STRING_LENGTH = 4_096;
const MAX_JSON_DEPTH = 8;

type BrowserInputMessage = Record<string, unknown> & { type: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isFiniteJson(value: unknown, depth = 0): boolean {
  if (depth > MAX_JSON_DEPTH) return false;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return value.length <= MAX_STRING_LENGTH;
  if (Array.isArray(value)) return value.length <= 100 && value.every((item) => isFiniteJson(item, depth + 1));
  if (isRecord(value)) {
    return Object.entries(value).length <= 32
      && Object.entries(value).every(([key, item]) => key.length <= 128 && isFiniteJson(item, depth + 1));
  }
  return value === null || typeof value === "boolean";
}

function hasOnlyKeys(message: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(message).every((key) => keys.includes(key));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isBrowserInputMessage(value: unknown): value is BrowserInputMessage {
  if (!isRecord(value) || typeof value.type !== "string" || !isFiniteJson(value)) return false;
  switch (value.type) {
    case "input_mouse":
      return hasOnlyKeys(value, ["type", "eventType", "x", "y", "button", "clickCount", "deltaX", "deltaY", "modifiers"])
        && ["mousePressed", "mouseReleased", "mouseMoved", "mouseWheel"].includes(String(value.eventType))
        && isFiniteNumber(value.x) && isFiniteNumber(value.y)
        && (value.button === undefined || ["left", "right", "middle", "back", "forward", "none"].includes(String(value.button)))
        && (value.clickCount === undefined || (Number.isInteger(value.clickCount) && Number(value.clickCount) >= 1 && Number(value.clickCount) <= 10))
        && (value.deltaX === undefined || isFiniteNumber(value.deltaX))
        && (value.deltaY === undefined || isFiniteNumber(value.deltaY))
        && (value.modifiers === undefined || (Number.isInteger(value.modifiers) && Number(value.modifiers) >= 0 && Number(value.modifiers) <= 31));
    case "input_keyboard":
      return hasOnlyKeys(value, ["type", "eventType", "key", "code", "text", "modifiers"])
        && ["keyDown", "keyUp", "char"].includes(String(value.eventType))
        && (typeof value.key === "string" && value.key.length > 0 && value.key.length <= 128
          || typeof value.text === "string" && value.text.length <= 1_024)
        && (value.code === undefined || (typeof value.code === "string" && value.code.length <= 128))
        && (value.modifiers === undefined || (Number.isInteger(value.modifiers) && Number(value.modifiers) >= 0 && Number(value.modifiers) <= 31));
    case "input_touch":
      return hasOnlyKeys(value, ["type", "eventType", "touchPoints"])
        && ["touchStart", "touchMove", "touchEnd", "touchCancel"].includes(String(value.eventType))
        && Array.isArray(value.touchPoints) && value.touchPoints.length <= 10
        && value.touchPoints.every((point) => isRecord(point)
          && hasOnlyKeys(point as BrowserInputMessage, ["id", "x", "y", "radiusX", "radiusY", "rotationAngle", "force"])
          && isFiniteNumber(point.x) && isFiniteNumber(point.y)
          && (point.id === undefined || (Number.isInteger(point.id) && Number(point.id) >= 0))
          && [point.radiusX, point.radiusY, point.rotationAngle, point.force].every((part) => part === undefined || isFiniteNumber(part)));
    case "config":
      return hasOnlyKeys(value, ["type", "pacing", "maxFps"])
        && (value.pacing === undefined || value.pacing === "ack" || value.pacing === "push")
        && (value.maxFps === undefined || (Number.isInteger(value.maxFps) && Number(value.maxFps) >= 0 && Number(value.maxFps) <= 120));
    case "ack":
      return hasOnlyKeys(value, ["type", "seq"])
        && isFiniteNumber(value.seq) && Number.isSafeInteger(value.seq) && value.seq >= 0;
    default:
      return false;
  }
}

function toBuffer(data: WebSocket.RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

function closeSocket(socket: WebSocket, code: number, reason: string): void {
  if (socket.readyState === WebSocket.OPEN) {
    try { socket.close(code, reason); } catch { try { socket.terminate(); } catch {} }
  } else if (socket.readyState === WebSocket.CONNECTING) {
    // ws throws when terminate() races the HTTP upgrade; close as soon as it opens.
    socket.once("open", () => closeSocket(socket, code, reason));
    socket.once("error", () => {
      try { socket.terminate(); } catch {}
    });
  }
}

function isValidCloseCode(code: number): boolean {
  return code === 1000
    || (code >= 1001 && code <= 1014 && ![1004, 1005, 1006].includes(code))
    || (code >= 3000 && code <= 4999);
}

function fitCloseReason(reason: Buffer): string {
  let value = "";
  for (const character of reason.toString("utf8")) {
    if (Buffer.byteLength(value + character) > 123) break;
    value += character;
  }
  return value;
}

async function proxyBrowserStream(
  client: WebSocket,
  sessionId: string,
  port: number,
  log: FastifyRequest["log"],
): Promise<void> {
  const receiver = (client as unknown as { _receiver?: { _maxPayload: number } })._receiver;
  if (receiver) receiver._maxPayload = MAX_CLIENT_MESSAGE_BYTES;

  const upstream = new WebSocket(`ws://127.0.0.1:${port}/?pacing=ack&maxFps=10`, { perMessageDeflate: false });
  let closed = false;
  let pendingBytes = 0;
  const pendingMessages: Buffer[] = [];

  const cleanup = (code: number, reason: string) => {
    if (closed) return;
    closed = true;
    client.off("message", onClientMessage);
    client.off("close", onClientClose);
    client.off("error", onClientError);
    upstream.off("open", onUpstreamOpen);
    upstream.off("message", onUpstreamMessage);
    upstream.off("close", onUpstreamClose);
    upstream.off("error", onUpstreamError);
    closeSocket(client, code, reason);
    closeSocket(upstream, code, reason);
  };

  const onClientMessage = (data: WebSocket.RawData, isBinary: boolean) => {
    const raw = toBuffer(data);
    if (raw.byteLength > MAX_CLIENT_MESSAGE_BYTES) {
      cleanup(1009, "browser input too large");
      return;
    }
    if (isBinary) {
      cleanup(1008, "binary browser input is not supported");
      return;
    }
    let value: unknown;
    try {
      value = JSON.parse(raw.toString("utf8"));
    } catch {
      cleanup(1008, "invalid browser input JSON");
      return;
    }
    if (!isBrowserInputMessage(value)) {
      cleanup(1008, "unsupported browser input");
      return;
    }
    if (upstream.readyState === WebSocket.OPEN) {
      if (upstream.bufferedAmount + raw.byteLength > MAX_PROXY_BUFFERED_BYTES) {
        cleanup(1013, "browser input backlog");
        return;
      }
      upstream.send(raw, { binary: false });
      return;
    }
    if (upstream.readyState === WebSocket.CONNECTING && pendingBytes + raw.byteLength <= MAX_CLIENT_MESSAGE_BYTES) {
      pendingMessages.push(raw);
      pendingBytes += raw.byteLength;
      return;
    }
    cleanup(1011, "browser stream unavailable");
  };

  const onClientClose = (code: number, rawReason: Buffer) => {
    cleanup(isValidCloseCode(code) ? code : 1011, fitCloseReason(rawReason));
  };
  const onClientError = (error: Error) => {
    log.warn({ sessionId, err: error }, "browser panel client WebSocket failed");
    cleanup(1011, "browser stream failed");
  };
  const onUpstreamOpen = () => {
    if (upstream.bufferedAmount + pendingBytes > MAX_PROXY_BUFFERED_BYTES) {
      cleanup(1013, "browser input backlog");
      return;
    }
    for (const message of pendingMessages) upstream.send(message, { binary: false });
    pendingMessages.length = 0;
    pendingBytes = 0;
  };
  const onUpstreamMessage = (data: WebSocket.RawData, isBinary: boolean) => {
    if (client.readyState !== WebSocket.OPEN) return;
    const size = toBuffer(data).byteLength;
    if (client.bufferedAmount + size > MAX_PROXY_BUFFERED_BYTES) {
      cleanup(1013, "browser panel client is too slow");
      return;
    }
    client.send(data, { binary: isBinary });
  };
  const onUpstreamClose = (code: number, rawReason: Buffer) => {
    const reason = fitCloseReason(rawReason);
    const validCode = isValidCloseCode(code);
    cleanup(validCode ? code : 1011, reason || (validCode ? "" : "browser stream closed"));
  };
  const onUpstreamError = (error: Error) => {
    log.warn({ sessionId, err: error }, "browser stream WebSocket failed");
    cleanup(1011, "browser stream failed");
  };

  client.on("message", onClientMessage);
  client.once("close", onClientClose);
  client.once("error", onClientError);
  upstream.once("open", onUpstreamOpen);
  upstream.on("message", onUpstreamMessage);
  upstream.once("close", onUpstreamClose);
  upstream.once("error", onUpstreamError);
}

export const browserWsRoutes: FastifyPluginAsync = async (app) => {
  const preparePanel = async (
    request: FastifyRequest<{ Params: { sessionId: string } }>,
    reply: FastifyReply,
  ) => {
    const { sessionId } = request.params;
    if (!isAllowedLocalOrigin(request.headers.origin)) {
      return reply.code(403).send({ error: "origin not allowed" });
    }
    if (!app.sessions.findById(sessionId)) return reply.code(404).send({ error: "session not found" });
    try {
      await app.browserManager.ensurePanelSession(sessionId);
    } catch (error) {
      request.log.warn({ sessionId, err: error }, "failed to prepare browser panel stream");
      return reply.code(503).send({ error: "browser stream unavailable" });
    }
  };

  app.get<{ Params: { sessionId: string } }>(
    "/ws/browser/:sessionId",
    { websocket: true, preValidation: preparePanel },
    (client, request) => {
      const sessionId = request.params.sessionId;
      if (!app.sessions.findById(sessionId)) {
        client.close(1008, "session not found");
        return;
      }
      const port = app.browserManager.getPanelStreamPort(sessionId);
      if (port === null || !Number.isInteger(port) || port <= 0 || port > 65_535) {
        request.log.warn({ sessionId, port }, "browser panel stream port unavailable");
        closeSocket(client, 1011, "browser stream unavailable");
        return;
      }
      void proxyBrowserStream(client, sessionId, port, request.log);
    },
  );
};
