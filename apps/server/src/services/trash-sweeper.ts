import type { FastifyBaseLogger } from "fastify";
import type { ProjectRepository } from "../db/repositories/project.js";
import type { SessionRepository } from "../db/repositories/session.js";

/**
 * Periodically purges trash items (deleted projects / sessions) that have
 * been in the trash longer than the configured retention period. Mirrors
 * the behavior of OS trash bins (e.g. macOS "remove items after 30 days").
 */
export class TrashSweeper {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private projects: ProjectRepository,
    private sessions: SessionRepository,
    private retentionMs: number,
    private logger: FastifyBaseLogger,
    private intervalMs = 60 * 60 * 1000, // hourly
  ) {}

  start(): void {
    if (this.timer) return;
    // Run once at startup, then on the interval.
    this.sweep();
    this.timer = setInterval(() => this.sweep(), this.intervalMs);
    // Don't keep the process alive solely for the sweeper.
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  sweep(): void {
    if (this.retentionMs <= 0) return; // retention disabled
    const cutoff = Date.now() - this.retentionMs;
    try {
      const projectIds = this.projects.purgeDeletedOlderThan(cutoff);
      const sessionIds = this.sessions.purgeDeletedOlderThan(cutoff);
      const total = projectIds.length + sessionIds.length;
      if (total > 0) {
        this.logger.info(
          { projects: projectIds.length, sessions: sessionIds.length },
          "[TrashSweeper] purged expired trash items",
        );
      }
    } catch (err) {
      this.logger.error({ err }, "[TrashSweeper] sweep failed");
    }
  }
}
