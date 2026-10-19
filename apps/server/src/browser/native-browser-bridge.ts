import { randomUUID } from "node:crypto";
import WebSocket from "ws";

type NativeBrowserResult = {
  requestId: string;
  result?: unknown;
  error?: string;
};

type PendingRequest = {
  sessionId: string;
  instanceId: string;
  socket: WebSocket;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  abort?: () => void;
};

type NativeBrowserClient = {
  sessionId: string;
  instanceId: string;
  socket: WebSocket;
};

const REQUEST_TIMEOUT_MS = 60_000;

/** Local bridge between browser tools and the active Tauri view. */
export class NativeBrowserBridge {
  private readonly clients = new Map<string, NativeBrowserClient>();
  private readonly pending = new Map<string, PendingRequest>();

  register(sessionId: string, instanceId: string, socket: WebSocket): () => void {
    const client = { sessionId, instanceId, socket };
    this.clients.set(sessionId, client);
    const unregister = () => {
      if (this.clients.get(sessionId) === client) this.clients.delete(sessionId);
      for (const [requestId, request] of this.pending) {
        if (request.socket === socket) {
          this.reject(requestId, new Error("native browser panel disconnected"));
        }
      }
    };
    socket.once("close", unregister);
    socket.once("error", unregister);
    return unregister;
  }

  async execute(
    sessionId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const client = this.clients.get(sessionId);
    if (!client || client.socket.readyState !== WebSocket.OPEN) {
      throw new Error("请先在右侧面板打开浏览器标签，再让 Agent 操作当前页面。");
    }
    if (signal?.aborted) throw new Error("browser operation was cancelled");

    const requestId = randomUUID();
    const result = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.reject(requestId, new Error("native browser operation timed out"));
      }, REQUEST_TIMEOUT_MS);
      const abort = signal
        ? () => this.reject(requestId, new Error("browser operation was cancelled"))
        : undefined;
      const pending: PendingRequest = {
        sessionId,
        instanceId: client.instanceId,
        socket: client.socket,
        resolve,
        reject,
        timer,
        signal,
        abort,
      };
      this.pending.set(requestId, pending);
      if (abort) signal?.addEventListener("abort", abort, { once: true });
      try {
        client.socket.send(JSON.stringify({
          type: "agent-browser-action",
          requestId,
          params,
        }));
      } catch (error) {
        this.reject(requestId, error instanceof Error ? error : new Error(String(error)));
      }
    });
    return result;
  }

  resolve(sessionId: string, instanceId: string, response: NativeBrowserResult): void {
    const pending = this.pending.get(response.requestId);
    if (!pending || pending.sessionId !== sessionId || pending.instanceId !== instanceId) return;
    this.clear(response.requestId, pending);
    if (typeof response.error === "string") pending.reject(new Error(response.error));
    else pending.resolve(response.result);
  }

  private reject(requestId: string, error: Error): void {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    this.clear(requestId, pending);
    pending.reject(error);
  }

  private clear(requestId: string, pending: PendingRequest): void {
    clearTimeout(pending.timer);
    if (pending.abort) pending.signal?.removeEventListener("abort", pending.abort);
    this.pending.delete(requestId);
  }

}

export const nativeBrowserBridge = new NativeBrowserBridge();
