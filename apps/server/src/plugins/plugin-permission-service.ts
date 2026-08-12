import type { ServerEvent } from "@pi-web-ui/shared";
import { ulid } from "../util/ulid.js";

interface PendingPermission {
  sessionId: string;
  timer: NodeJS.Timeout;
  resolve: (approved: boolean) => void;
}

export class PluginPermissionService {
  private readonly pending = new Map<string, PendingPermission>();

  request(input: {
    sessionId: string;
    pluginId: string;
    action: string;
    reason: string;
    intent?: string;
    context?: {
      url?: string;
      target?: string;
      windowId?: string;
      files?: string[];
    };
    send: (event: ServerEvent) => void;
    signal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<boolean> {
    if (input.signal?.aborted) return Promise.resolve(false);
    const requestId = ulid();
    const timeoutMs = Math.max(5_000, Math.min(input.timeoutMs ?? 60_000, 120_000));
    const expiresAt = Date.now() + timeoutMs;
    return new Promise<boolean>((resolve) => {
      const finish = (approved: boolean) => {
        const pending = this.pending.get(requestId);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(requestId);
        input.signal?.removeEventListener("abort", abort);
        resolve(approved);
      };
      const abort = () => finish(false);
      const timer = setTimeout(() => finish(false), timeoutMs);
      this.pending.set(requestId, {
        sessionId: input.sessionId,
        timer,
        resolve: finish,
      });
      input.signal?.addEventListener("abort", abort, { once: true });
      input.send({
        type: "permission_request",
        sessionId: input.sessionId,
        requestId,
        pluginId: input.pluginId,
        action: input.action,
        reason: input.reason,
        intent: input.intent,
        context: input.context,
        expiresAt,
      });
    });
  }

  respond(sessionId: string, requestId: string, approved: boolean): boolean {
    const pending = this.pending.get(requestId);
    if (!pending || pending.sessionId !== sessionId) return false;
    pending.resolve(approved);
    return true;
  }

  cancelSession(sessionId: string): void {
    for (const pending of [...this.pending.values()]) {
      if (pending.sessionId !== sessionId) continue;
      pending.resolve(false);
    }
  }

  shutdown(): void {
    for (const pending of [...this.pending.values()]) pending.resolve(false);
  }
}
