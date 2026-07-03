interface Tracked { lastActivityAt: number; idleFired: boolean; }

export interface IdleSweeperOptions {
  idleTimeoutMs: number;
  suspendedTimeoutMs: number;
  onIdle: (sessionId: string) => void;
  onSuspend: (sessionId: string) => void;
}

export class IdleSweeper {
  private tracked = new Map<string, Tracked>();
  private opts: IdleSweeperOptions;
  private timer?: ReturnType<typeof setInterval>;

  constructor(opts: IdleSweeperOptions) {
    this.opts = opts;
    this.timer = setInterval(() => this.tick(), 1000);
  }

  track(sessionId: string, opts: { lastActivityAt: number }) {
    this.tracked.set(sessionId, { lastActivityAt: opts.lastActivityAt, idleFired: false });
  }

  touch(sessionId: string) {
    const t = this.tracked.get(sessionId);
    if (t) { t.lastActivityAt = Date.now(); t.idleFired = false; }
  }

  untrack(sessionId: string) { this.tracked.delete(sessionId); }

  private tick() {
    const now = Date.now();
    for (const [id, t] of this.tracked) {
      const idleFor = now - t.lastActivityAt;
      if (!t.idleFired && idleFor >= this.opts.idleTimeoutMs) {
        t.idleFired = true;
        this.opts.onIdle(id);
      }
      if (idleFor >= this.opts.suspendedTimeoutMs) {
        this.opts.onSuspend(id);
        this.tracked.delete(id);
      }
    }
  }

  stop() { if (this.timer) clearInterval(this.timer); }
}
