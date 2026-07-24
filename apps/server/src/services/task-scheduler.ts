import { Cron } from "croner";
import type { FastifyBaseLogger } from "fastify";
import type { ScheduledTaskDto } from "@pi-web-ui/shared";
import type { ScheduledTaskRepository, TaskLogRepository } from "../db/repositories/scheduled-task.js";
import type { TaskExecutor } from "./task-executor.js";

export class TaskScheduler {
  private jobs = new Map<string, Cron>();
  private running = false;
  private executor: TaskExecutor | null = null;

  constructor(
    private tasks: ScheduledTaskRepository,
    private logs: TaskLogRepository,
    private logger: FastifyBaseLogger,
  ) {}

  /** Inject the executor after ProcessManager is ready (called from wiring). */
  setExecutor(executor: TaskExecutor): void {
    this.executor = executor;
  }

  /** Load all enabled tasks and schedule them. */
  start(): void {
    if (this.running) return;
    this.running = true;
    const enabled = this.tasks.listEnabled();
    this.logger.info(`[TaskScheduler] starting with ${enabled.length} enabled task(s)`);
    for (const task of enabled) {
      this.scheduleTask(task);
    }
  }

  /** Stop all scheduled jobs. */
  stop(): void {
    for (const [id, job] of this.jobs) {
      job.stop();
      this.logger.debug(`[TaskScheduler] stopped job ${id}`);
    }
    this.jobs.clear();
    this.running = false;
    this.logger.info("[TaskScheduler] all jobs stopped");
  }

  /** Add or update a single task's schedule. */
  upsertTask(taskId: string): void {
    // Remove existing job if any
    this.removeTask(taskId);

    const task = this.tasks.findById(taskId);
    if (!task) return;

    if (task.enabled) {
      this.scheduleTask(task);
    }

    // Compute and persist next run time
    const job = this.jobs.get(taskId);
    if (job) {
      const next = job.nextRun();
      this.tasks.updateNextRun(taskId, next ? next.getTime() : null);
    } else {
      this.tasks.updateNextRun(taskId, null);
    }
  }

  /** Remove a task's cron job. */
  removeTask(taskId: string): void {
    const existing = this.jobs.get(taskId);
    if (existing) {
      existing.stop();
      this.jobs.delete(taskId);
      this.logger.debug(`[TaskScheduler] removed job ${taskId}`);
    }
  }

  /** Execute a task immediately (manual trigger). */
  async executeNow(taskId: string): Promise<void> {
    const task = this.tasks.findById(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    await this.runTask(task);
  }

  // ─── Private ───

  private scheduleTask(task: ScheduledTaskDto): void {
    try {
      const job = new Cron(task.cronExpression, async () => {
        // Re-read task to get latest state (it may have been disabled)
        const fresh = this.tasks.findById(task.id);
        if (!fresh || !fresh.enabled) return;
        await this.runTask(fresh);
      });

      this.jobs.set(task.id, job);
      this.logger.info(`[TaskScheduler] scheduled task "${task.name}" (${task.id}) with cron "${task.cronExpression}"`);

      // Persist next run time
      const next = job.nextRun();
      this.tasks.updateNextRun(task.id, next ? next.getTime() : null);
    } catch (err) {
      this.logger.error(`[TaskScheduler] failed to schedule task "${task.name}" (${task.id}): ${err}`);
      // Auto-disable tasks with invalid cron expressions
      this.tasks.update(task.id, { enabled: false });
    }
  }

  private async runTask(task: ScheduledTaskDto): Promise<void> {
    const log = this.logs.create(task.id);
    let output = "";
    let status: "success" | "failed" = "success";
    let sessionId: string | null = null;

    try {
      const payload = JSON.parse(task.payload || "{}");

      switch (task.taskType) {
        case "prompt": {
          const promptText = payload.prompt || "";

          if (task.projectId && this.executor) {
            // Execute the prompt through the agent pipeline
            this.logger.info(`[TaskScheduler] executing prompt task "${task.name}" via agent: ${promptText.slice(0, 100)}`);
            const result = await this.executor.executePrompt({
              taskName: task.name,
              projectId: task.projectId,
              promptText,
            });
            sessionId = result.sessionId;
            output = result.response
              ? `会话已创建，AI 回复如下:\n\n${result.response}`
              : `会话已创建 (sessionId: ${result.sessionId})，请前往对话查看回复。`;
            this.logger.info(`[TaskScheduler] prompt task "${task.name}" completed, session=${sessionId}`);
          } else {
            // No project or executor — fall back to recording only
            output = `[自动提问] ${task.name}\n\n提示词: ${promptText}\n\n提示: 请为任务指定目标项目以启用自动执行。`;
            this.logger.info(`[TaskScheduler] recorded prompt task "${task.name}" (no project/executor)`);
          }
          break;
        }
        case "reminder": {
          const message = payload.message || "";
          output = `[提醒] ${task.name}\n\n${message}`;
          this.logger.info(`[TaskScheduler] executed reminder task "${task.name}": ${message.slice(0, 100)}`);
          break;
        }
        default: {
          output = `[未知任务类型] ${task.taskType}`;
          status = "failed";
        }
      }
    } catch (err) {
      output = `执行失败: ${err instanceof Error ? err.message : String(err)}`;
      status = "failed";
      this.logger.error(`[TaskScheduler] task "${task.name}" (${task.id}) failed: ${err}`);
    }

    // Update session ID if we created a session
    if (sessionId) {
      this.logs.setSessionId(log.id, sessionId);
    }
    this.logs.finish(log.id, status, output);

    // Update last_run_at and next_run_at
    const now = Date.now();
    const job = this.jobs.get(task.id);
    const nextRun = job?.nextRun();
    this.tasks.updateLastRun(task.id, now, nextRun ? nextRun.getTime() : null);
  }
}
