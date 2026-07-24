import type Database from "better-sqlite3";
import type { ScheduledTaskDto, TaskLogDto, TaskType } from "@pi-web-ui/shared";
import { ulid } from "../../util/ulid.js";

// ─── Row types (snake_case, matches DB columns) ───

type TaskRow = {
  id: string;
  name: string;
  description: string;
  cron_expression: string;
  task_type: TaskType;
  payload: string;
  enabled: number;
  last_run_at: number | null;
  next_run_at: number | null;
  created_at: number;
  updated_at: number;
};

type LogRow = {
  id: string;
  task_id: string;
  status: "success" | "failed" | "running";
  output: string;
  started_at: number;
  finished_at: number | null;
};

function taskToDto(r: TaskRow): ScheduledTaskDto {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    cronExpression: r.cron_expression,
    taskType: r.task_type,
    payload: r.payload,
    enabled: r.enabled === 1,
    lastRunAt: r.last_run_at,
    nextRunAt: r.next_run_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function logToDto(r: LogRow): TaskLogDto {
  return {
    id: r.id,
    taskId: r.task_id,
    status: r.status,
    output: r.output,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
  };
}

// ─── ScheduledTaskRepository ───

export class ScheduledTaskRepository {
  constructor(private db: Database.Database) {}

  list(): ScheduledTaskDto[] {
    return (
      this.db
        .prepare("SELECT * FROM scheduled_tasks ORDER BY created_at DESC")
        .all() as TaskRow[]
    ).map(taskToDto);
  }

  listEnabled(): ScheduledTaskDto[] {
    return (
      this.db
        .prepare("SELECT * FROM scheduled_tasks WHERE enabled = 1 ORDER BY created_at DESC")
        .all() as TaskRow[]
    ).map(taskToDto);
  }

  findById(id: string): ScheduledTaskDto | null {
    const r = this.db
      .prepare("SELECT * FROM scheduled_tasks WHERE id = ?")
      .get(id) as TaskRow | undefined;
    return r ? taskToDto(r) : null;
  }

  create(input: {
    name: string;
    description?: string;
    cronExpression: string;
    taskType: TaskType;
    payload?: string;
    enabled?: boolean;
  }): ScheduledTaskDto {
    const id = ulid();
    const now = Date.now();
    const description = input.description ?? "";
    const payload = input.payload ?? "{}";
    const enabled = input.enabled !== false ? 1 : 0;

    this.db
      .prepare(
        `INSERT INTO scheduled_tasks
          (id, name, description, cron_expression, task_type, payload, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.name, description, input.cronExpression, input.taskType, payload, enabled, now, now);

    return {
      id,
      name: input.name,
      description,
      cronExpression: input.cronExpression,
      taskType: input.taskType,
      payload,
      enabled: enabled === 1,
      lastRunAt: null,
      nextRunAt: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  update(
    id: string,
    patch: Partial<{
      name: string;
      description: string;
      cronExpression: string;
      taskType: TaskType;
      payload: string;
      enabled: boolean;
    }>,
  ): ScheduledTaskDto | null {
    const cur = this.findById(id);
    if (!cur) return null;

    const name = patch.name ?? cur.name;
    const description = patch.description ?? cur.description;
    const cronExpression = patch.cronExpression ?? cur.cronExpression;
    const taskType = patch.taskType ?? cur.taskType;
    const payload = patch.payload ?? cur.payload;
    const enabled = patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : cur.enabled ? 1 : 0;
    const now = Date.now();

    this.db
      .prepare(
        `UPDATE scheduled_tasks
         SET name = ?, description = ?, cron_expression = ?, task_type = ?, payload = ?, enabled = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(name, description, cronExpression, taskType, payload, enabled, now, id);

    return {
      ...cur,
      name,
      description,
      cronExpression,
      taskType,
      payload,
      enabled: enabled === 1,
      updatedAt: now,
    };
  }

  toggle(id: string, enabled: boolean): ScheduledTaskDto | null {
    return this.update(id, { enabled });
  }

  updateLastRun(id: string, lastRunAt: number, nextRunAt: number | null): void {
    this.db
      .prepare("UPDATE scheduled_tasks SET last_run_at = ?, next_run_at = ?, updated_at = ? WHERE id = ?")
      .run(lastRunAt, nextRunAt, Date.now(), id);
  }

  updateNextRun(id: string, nextRunAt: number | null): void {
    this.db
      .prepare("UPDATE scheduled_tasks SET next_run_at = ? WHERE id = ?")
      .run(nextRunAt, id);
  }

  delete(id: string): boolean {
    const result = this.db.prepare("DELETE FROM scheduled_tasks WHERE id = ?").run(id);
    return result.changes > 0;
  }
}

// ─── TaskLogRepository ───

export class TaskLogRepository {
  constructor(private db: Database.Database) {}

  listByTaskId(taskId: string, limit = 50): TaskLogDto[] {
    return (
      this.db
        .prepare("SELECT * FROM task_logs WHERE task_id = ? ORDER BY started_at DESC LIMIT ?")
        .all(taskId, limit) as LogRow[]
    ).map(logToDto);
  }

  create(taskId: string): TaskLogDto {
    const id = ulid();
    const now = Date.now();
    this.db
      .prepare("INSERT INTO task_logs (id, task_id, status, started_at) VALUES (?, ?, 'running', ?)")
      .run(id, taskId, now);
    return { id, taskId, status: "running", output: "", startedAt: now, finishedAt: null };
  }

  finish(id: string, status: "success" | "failed", output: string): void {
    this.db
      .prepare("UPDATE task_logs SET status = ?, output = ?, finished_at = ? WHERE id = ?")
      .run(status, output, Date.now(), id);
  }
}
