import type { FastifyBaseLogger } from "fastify";
import { KbParseJobRepository } from "../db/repositories/kb-parse-job.js";
import { ParsePipeline } from "./parse-pipeline.js";

const IDLE_POLL_MS = 500;
const HEARTBEAT_MS = 10_000;

export class KbParseJobWorker {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  private running = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private stopWaiters: Array<() => void> = [];

  constructor(
    private jobs: KbParseJobRepository,
    private pipeline: ParsePipeline,
    private logger: FastifyBaseLogger,
  ) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    const recovered = this.jobs.recoverInterrupted();
    if (recovered > 0) this.logger.info({ recovered }, "recovered interrupted KB parse jobs");
    this.schedule(0);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.running) {
      await new Promise<void>((resolve) => this.stopWaiters.push(resolve));
    }
  }

  enqueue(fileId: string): void {
    this.jobs.enqueue(fileId);
    if (!this.running) this.schedule(0);
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), delayMs);
  }

  private async tick(): Promise<void> {
    if (this.stopped || this.running) return;
    const expired = this.jobs.recoverExpired();
    if (expired > 0) this.logger.warn({ recovered: expired }, "recovered expired KB parse job leases");
    const job = this.jobs.claimNext();
    if (!job) {
      this.schedule(IDLE_POLL_MS);
      return;
    }

    this.running = true;
    this.heartbeatTimer = setInterval(() => this.jobs.heartbeat(job.fileId), HEARTBEAT_MS);
    try {
      const result = await this.pipeline.parseFile(job.fileId);
      if (result.success) {
        this.jobs.complete(job.fileId);
      } else {
        this.jobs.retryOrFail(job, result.failReason ?? "parse_failed");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error({ err: error, fileId: job.fileId }, "KB parse job failed");
      this.jobs.retryOrFail(job, message);
    } finally {
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
      this.running = false;
      for (const resolve of this.stopWaiters.splice(0)) resolve();
      this.schedule(0);
    }
  }
}
