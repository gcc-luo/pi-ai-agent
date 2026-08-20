import type { ClientEvent, ServerEvent } from "@pi-web-ui/shared";
import { authToken, webSocketUrl } from "./endpoints.js";

type Listener = (e: ServerEvent) => void;
type Status = "disconnected" | "connecting" | "connected";
type SequencedEvent = ServerEvent & { eventSeq?: number };

export class WsClient {
  private ws?: WebSocket;
  private listeners = new Set<Listener>();
  private reconnectAttempts = 0;
  private status: Status = "disconnected";
  private statusListeners = new Set<(s: Status) => void>();
  private subscriptions = new Set<string>();
  private pingTimer?: number;
  private reconnectTimer?: number;
  private manuallyClosed = false;
  private pending: ClientEvent[] = [];
  private lastEventSeq = new Map<string, number>();

  connect() {
    if (this.ws) return;
    this.manuallyClosed = false;
    this.setStatus("connecting");
    const token = authToken();
    this.ws = new WebSocket(webSocketUrl("/ws/agent"), token ? ["pi-web-ui", token] : undefined);
    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.setStatus("connected");
      for (const sessionId of this.subscriptions) {
        this.ws?.send(JSON.stringify({
          type: "subscribe",
          sessionId,
          afterEventSeq: this.lastEventSeq.get(sessionId) ?? 0,
        }));
      }
      for (const event of this.pending.splice(0)) this.ws?.send(JSON.stringify(event));
      this.pingTimer = window.setInterval(() => this.send({ type: "ping" }), 25000);
    };
    this.ws.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data) as SequencedEvent;
        const sessionId = "sessionId" in event ? event.sessionId : undefined;
        if (event.eventSeq !== undefined && sessionId) {
          const previous = this.lastEventSeq.get(sessionId) ?? 0;
          if (event.eventSeq <= previous) return;
          this.lastEventSeq.set(sessionId, event.eventSeq);
        }
        this.listeners.forEach((l) => l(event));
      } catch {}
    };
    this.ws.onclose = () => this.scheduleReconnect();
    this.ws.onerror = () => this.ws?.close();
  }

  private scheduleReconnect() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.setStatus("disconnected");
    this.ws = undefined;
    if (this.manuallyClosed) return;
    const delay = Math.min(30000, 1000 * 2 ** this.reconnectAttempts);
    this.reconnectAttempts++;
    this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
  }

  private setStatus(s: Status) {
    this.status = s;
    this.statusListeners.forEach((l) => l(s));
  }

  send(event: ClientEvent): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      if (event.type !== "ping" && this.pending.length < 50) this.pending.push(event);
      return event.type !== "ping";
    }
    try {
      this.ws.send(JSON.stringify(event));
      return true;
    } catch {
      return false;
    }
  }

  subscribe(sessionId: string) {
    this.subscriptions.add(sessionId);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: "subscribe",
        sessionId,
        afterEventSeq: this.lastEventSeq.get(sessionId) ?? 0,
      }));
    }
  }

  unsubscribe(sessionId: string) {
    this.subscriptions.delete(sessionId);
    this.lastEventSeq.delete(sessionId);
  }

  onEvent(l: Listener) { this.listeners.add(l); return () => this.listeners.delete(l); }
  onStatusChange(l: (s: Status) => void) {
    this.statusListeners.add(l);
    l(this.status);
    return () => this.statusListeners.delete(l);
  }

  close() {
    this.manuallyClosed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.ws?.close();
    this.ws = undefined;
  }
}

export const wsClient = new WsClient();
