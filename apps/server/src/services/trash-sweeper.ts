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
    private onSessionPurged?: (sessionId: string) => Promise<void> | void,
  ) {}

  start(): void {
    if (this.timer) return;
    // Run once at startup, then on the interval.
    void this.sweep();
    this.timer = setInterval(() => void this.sweep(), this.intervalMs);
    // Don't keep the process alive solely for the sweeper.
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async sweep(): Promise<void> {
    if (this.retentionMs <= 0) return; // retention disabled
    const cutoff = Date.now() - this.retentionMs;
    try {
      // Capture every child before project deletion cascades through sessions.
      const expiredProjectSessions = new Map(
        this.projects.listDeleted()
          .filter((project) => project.deletedAt !== null && project.deletedAt < cutoff)
          .map((project) => [project.id, this.sessions.listIdsByProject(project.id)]),
      );
      const projectIds = this.projects.purgeDeletedOlderThan(cutoff);
      const sessionIds = this.sessions.purgeDeletedOlderThan(cutoff);
      const purgedSessionIds = new Set(sessionIds);
      for (const projectId of projectIds) {
        for (const sessionId of expiredProjectSessions.get(projectId) ?? []) {
          purgedSessionIds.add(sessionId);
        }
      }

      if (this.onSessionPurged && purgedSessionIds.size > 0) {
        const results = await Promise.allSettled(
          [...purgedSessionIds].map((sessionId) =>
            Promise.resolve().then(() => this.onSessionPurged!(sessionId)),
          ),
        );
        const failures = results.filter((result) => result.status === "rejected");
        if (failures.length > 0) {
          this.logger.error(
            { count: failures.length, errors: failures.map((result) => result.reason) },
            "[TrashSweeper] failed to forget purged browser sessions",
          );
        }
      }

      const total = projectIds.length + purgedSessionIds.size;
      if (total > 0) {
        this.logger.info(
          { projects: projectIds.length, sessions: purgedSessionIds.size },
          "[TrashSweeper] purged expired trash items",
        );
      }
    } catch (err) {
      this.logger.error({ err }, "[TrashSweeper] sweep failed");
    }
  }
}
