import type { ServerEvent } from "@pi-web-ui/shared";

const DEFAULT_LIMIT = 500;

/**
 * Keeps a bounded in-memory event window for each session. This covers the
 * common desktop reconnect case without turning transient stream events into
 * a second durable message store. Persisted messages remain the source of
 * truth after a full application restart.
 */
export class SessionEventBuffer {
  private readonly events = new Map<string, ServerEvent[]>();
  private readonly nextSeq = new Map<string, number>();

  constructor(private readonly limit = DEFAULT_LIMIT) {}

  append(sessionId: string, event: ServerEvent): ServerEvent {
    const seq = this.nextSeq.get(sessionId) ?? 0;
    const stamped = { ...event, eventSeq: seq + 1 };
    this.nextSeq.set(sessionId, seq + 1);
    const history = this.events.get(sessionId) ?? [];
    history.push(stamped);
    if (history.length > this.limit) history.splice(0, history.length - this.limit);
    this.events.set(sessionId, history);
    return stamped;
  }

  replay(sessionId: string, afterEventSeq: number | undefined, send: (event: ServerEvent) => void): void {
    const after = Number.isFinite(afterEventSeq) ? afterEventSeq ?? 0 : 0;
    for (const event of this.events.get(sessionId) ?? []) {
      if ((event.eventSeq ?? 0) > after) send(event);
    }
  }

  clear(sessionId: string): void {
    this.events.delete(sessionId);
    this.nextSeq.delete(sessionId);
  }
}
