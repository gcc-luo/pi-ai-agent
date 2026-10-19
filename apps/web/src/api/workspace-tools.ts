import { api } from "./client.js";
import { authToken, webSocketUrl } from "./endpoints.js";

export type BrowserPanelActionResult = { status: "open" } | { status: "closed" };

export interface BrowserFrameMetadata {
  deviceWidth: number;
  deviceHeight: number;
  pageScaleFactor?: number;
  offsetTop?: number;
  scrollOffsetX?: number;
  scrollOffsetY?: number;
  timestamp?: number;
}

export interface BrowserFrameMessage {
  type: "frame";
  seq: number;
  data: string;
  metadata?: Partial<BrowserFrameMetadata>;
}

export type BrowserServerMessage =
  | BrowserFrameMessage
  | { type: "url"; url: string }
  | { type: "status"; [key: string]: unknown }
  | { type: "tabs"; [key: string]: unknown }
  | { type: "console"; [key: string]: unknown };

export type BrowserClientMessage =
  | { type: "config"; pacing: "ack"; maxFps: 10 }
  | { type: "ack"; seq: number }
  | {
      type: "input_mouse";
      eventType: "mousePressed" | "mouseReleased" | "mouseMoved" | "mouseWheel";
      x: number;
      y: number;
      button?: "left" | "right" | "middle" | "back" | "forward" | "none";
      clickCount?: number;
      deltaX?: number;
      deltaY?: number;
      modifiers?: number;
    }
  | {
      type: "input_keyboard";
      eventType: "keyDown" | "keyUp" | "char";
      key?: string;
      code?: string;
      text?: string;
      modifiers?: number;
    }
  | {
      type: "input_touch";
      eventType: "touchStart" | "touchMove" | "touchEnd" | "touchCancel";
      touchPoints: Array<{ id: number; x: number; y: number; force?: number }>;
    };

export const openBrowserPanel = (sessionId: string) => api.openBrowserPanel(sessionId);
export const closeBrowserPanel = (sessionId: string) => api.closeBrowserPanel(sessionId);
export const navigateBrowserPanel = (sessionId: string, url: string) =>
  api.navigateBrowserPanel(sessionId, url);
export const backBrowserPanel = (sessionId: string) => api.backBrowserPanel(sessionId);
export const forwardBrowserPanel = (sessionId: string) => api.forwardBrowserPanel(sessionId);
export const reloadBrowserPanel = (sessionId: string) => api.reloadBrowserPanel(sessionId);

export function createBrowserSocket(sessionId: string): WebSocket {
  const token = authToken();
  const protocols = token ? ["pi-web-ui", token] : ["pi-web-ui"];
  return new WebSocket(webSocketUrl(`/ws/browser/${encodeURIComponent(sessionId)}`), protocols);
}

export interface BrowserViewportRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function scaleBrowserPoint(
  clientX: number,
  clientY: number,
  rect: BrowserViewportRect,
  pixelWidth: number,
  pixelHeight: number,
): { x: number; y: number } | null {
  if (rect.width <= 0 || rect.height <= 0 || pixelWidth <= 0 || pixelHeight <= 0) {
    return null;
  }

  const scale = Math.min(rect.width / pixelWidth, rect.height / pixelHeight);
  const displayedWidth = pixelWidth * scale;
  const displayedHeight = pixelHeight * scale;
  const offsetX = (rect.width - displayedWidth) / 2;
  const offsetY = (rect.height - displayedHeight) / 2;
  const localX = clientX - rect.left;
  const localY = clientY - rect.top;
  if (localX < offsetX || localX >= offsetX + displayedWidth
    || localY < offsetY || localY >= offsetY + displayedHeight) return null;

  const x = Math.floor((localX - offsetX) / scale);
  const y = Math.floor((localY - offsetY) / scale);
  return {
    x: Math.max(0, Math.min(pixelWidth - 1, x)),
    y: Math.max(0, Math.min(pixelHeight - 1, y)),
  };
}

export function parseBrowserServerMessage(data: unknown): BrowserServerMessage | null {
  if (typeof data !== "string") return null;
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const message = value as Record<string, unknown>;
  switch (message.type) {
    case "frame":
      if (!Number.isSafeInteger(message.seq) || Number(message.seq) < 0
        || typeof message.data !== "string"
        || message.data.length > 32 * 1024 * 1024
        || !/^[A-Za-z0-9+/]+={0,2}$/.test(message.data)) return null;
      return message as unknown as BrowserFrameMessage;
    case "url":
      return typeof message.url === "string" && message.url.length <= 4_096
        ? message as unknown as BrowserServerMessage
        : null;
    case "status":
    case "tabs":
    case "console":
      return message as BrowserServerMessage;
    default:
      return null;
  }
}
