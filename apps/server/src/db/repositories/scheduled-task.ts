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
  project_id: string | null;
  create_new_session: number;
  session_id: string | null;
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
  session_id: string | null;
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
    projectId: r.project_id,
    createNewSession: r.create_new_session === 1,
    sessionId: r.session_id,
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
    sessionId: r.session_id,
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
    projectId?: string;
    createNewSession?: boolean;
    enabled?: boolean;
  }): ScheduledTaskDto {
    const id = ulid();
    const now = Date.now();
    const description = input.description ?? "";
    const payload = input.payload ?? "{}";
    const projectId = input.projectId ?? null;
    const createNewSession = input.createNewSession ? 1 : 0;
    const enabled = input.enabled !== false ? 1 : 0;

    this.db
      .prepare(
        `INSERT INTO scheduled_tasks
          (id, name, description, cron_expression, task_type, payload, project_id, create_new_session, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.name, description, input.cronExpression, input.taskType, payload, projectId, createNewSession, enabled, now, now);

    return {
      id,
      name: input.name,
      description,
      cronExpression: input.cronExpression,
      taskType: input.taskType,
      payload,
      projectId,
      createNewSession: createNewSession === 1,
      sessionId: null,
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
      projectId: string | null;
      createNewSession: boolean;
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
    const projectId = patch.projectId !== undefined ? patch.projectId : cur.projectId;
    const createNewSession = patch.createNewSession !== undefined ? (patch.createNewSession ? 1 : 0) : cur.createNewSession ? 1 : 0;
    const enabled = patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : cur.enabled ? 1 : 0;
    const now = Date.now();

    this.db
      .prepare(
        `UPDATE scheduled_tasks
         SET name = ?, description = ?, cron_expression = ?, task_type = ?, payload = ?, project_id = ?, create_new_session = ?, enabled = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(name, description, cronExpression, taskType, payload, projectId, createNewSession, enabled, now, id);

    return {
      ...cur,
      name,
      description,
      cronExpression,
      taskType,
      payload,
      projectId,
      createNewSession: createNewSession === 1,
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

  setSessionId(id: string, sessionId: string): void {
    this.db
      .prepare("UPDATE scheduled_tasks SET session_id = ?, updated_at = ? WHERE id = ?")
      .run(sessionId, Date.now(), id);
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

  create(taskId: string, sessionId?: string | null): TaskLogDto {
    const id = ulid();
    const now = Date.now();
    const sid = sessionId ?? null;
    this.db
      .prepare("INSERT INTO task_logs (id, task_id, status, session_id, started_at) VALUES (?, ?, 'running', ?, ?)")
      .run(id, taskId, sid, now);
    return { id, taskId, status: "running", output: "", sessionId: sid, startedAt: now, finishedAt: null };
  }

  finish(id: string, status: "success" | "failed", output: string): void {
    this.db
      .prepare("UPDATE task_logs SET status = ?, output = ?, finished_at = ? WHERE id = ?")
      .run(status, output, Date.now(), id);
  }

  setSessionId(id: string, sessionId: string): void {
    this.db
      .prepare("UPDATE task_logs SET session_id = ? WHERE id = ?")
      .run(sessionId, id);
  }

  /** Mark executions interrupted by a process restart as failed. */
  recoverRunning(): number {
    const result = this.db.prepare(
      `UPDATE task_logs
       SET status = 'failed',
           output = CASE WHEN output = '' THEN '应用重启导致任务中断。' ELSE output || char(10) || '应用重启导致任务中断。' END,
           finished_at = ?
       WHERE status = 'running'`,
    ).run(Date.now());
    return result.changes;
  }
}
