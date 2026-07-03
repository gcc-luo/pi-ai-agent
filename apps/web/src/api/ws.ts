import type { ClientEvent, ServerEvent } from "@pi-web-ui/shared";

type Listener = (e: ServerEvent) => void;
type Status = "disconnected" | "connecting" | "connected";

export class WsClient {
  private ws?: WebSocket;
  private listeners = new Set<Listener>();
  private reconnectAttempts = 0;
  private status: Status = "disconnected";
  private statusListeners = new Set<(s: Status) => void>();
  private pingTimer?: number;

  connect() {
    if (this.ws) return;
    this.setStatus("connecting");
    const proto = location.protocol === "https:" ? "wss" : "ws";
    this.ws = new WebSocket(`${proto}://${location.host}/ws/agent`);
    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.setStatus("connected");
      this.pingTimer = window.setInterval(() => this.send({ type: "ping" }), 25000);
    };
    this.ws.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data) as ServerEvent;
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
    const delay = Math.min(30000, 1000 * 2 ** this.reconnectAttempts);
    this.reconnectAttempts++;
    setTimeout(() => this.connect(), delay);
  }

  private setStatus(s: Status) {
    this.status = s;
    this.statusListeners.forEach((l) => l(s));
  }

  send(event: ClientEvent) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(event));
  }

  onEvent(l: Listener) { this.listeners.add(l); return () => this.listeners.delete(l); }
  onStatusChange(l: (s: Status) => void) {
    this.statusListeners.add(l);
    l(this.status);
    return () => this.statusListeners.delete(l);
  }

  close() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.ws?.close();
  }
}

export const wsClient = new WsClient();
