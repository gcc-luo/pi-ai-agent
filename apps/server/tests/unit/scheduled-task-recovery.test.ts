import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { openDatabase } from "../../src/db/sqlite.js";
import { ScheduledTaskRepository, TaskLogRepository } from "../../src/db/repositories/scheduled-task.js";

describe("scheduled task recovery", () => {
  it("marks interrupted running logs as failed on startup", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-task-recovery-"));
    const db = openDatabase(path.join(tmp, "app.sqlite"));
    const tasks = new ScheduledTaskRepository(db);
    const logs = new TaskLogRepository(db);
    const task = tasks.create({
      name: "recovery probe",
      cronExpression: "* * * * *",
      taskType: "reminder",
      payload: JSON.stringify({ message: "hello" }),
      enabled: false,
    });
    const log = logs.create(task.id);

    expect(logs.recoverRunning()).toBe(1);
    expect(logs.listByTaskId(task.id)[0]).toMatchObject({
      id: log.id,
      status: "failed",
      output: "应用重启导致任务中断。",
    });

    db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
