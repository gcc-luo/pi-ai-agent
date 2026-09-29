import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations.js";
import { ScheduledTaskRepository } from "../../src/db/repositories/scheduled-task.js";

describe("ScheduledTaskRepository capabilities", () => {
  it("persists and reads the capability snapshot", () => {
    const db = new Database(":memory:");
    runMigrations(db);
    const tasks = new ScheduledTaskRepository(db);

    const task = tasks.create({
      name: "capability snapshot",
      cronExpression: "0 9 * * *",
      taskType: "prompt",
      payload: JSON.stringify({ prompt: "检查项目" }),
      capabilities: {
        skillNames: ["code-review", "code-review"],
        pluginIds: ["browser-use"],
        connectorIds: ["docs"],
        expertId: "expert-1",
      },
    });

    expect(tasks.findById(task.id)?.capabilities).toEqual({
      skillNames: ["code-review"],
      pluginIds: ["browser-use"],
      connectorIds: ["docs"],
      expertId: "expert-1",
    });
    db.close();
  });

  it("persists the message that an execution should reveal", async () => {
    const db = new Database(":memory:");
    runMigrations(db);
    const { TaskLogRepository } = await import("../../src/db/repositories/scheduled-task.js");
    const tasks = new ScheduledTaskRepository(db);
    const task = tasks.create({
      name: "message target",
      cronExpression: "0 9 * * *",
      taskType: "prompt",
      payload: JSON.stringify({ prompt: "检查" }),
    });
    const logs = new TaskLogRepository(db);
    const log = logs.create(task.id);

    logs.setMessageId(log.id, "message-9-05");

    expect(logs.listByTaskId(task.id)[0]?.messageId).toBe("message-9-05");
    db.close();
  });

  it("uses an empty capability snapshot when none is provided", () => {
    const db = new Database(":memory:");
    runMigrations(db);
    const tasks = new ScheduledTaskRepository(db);
    const task = tasks.create({
      name: "legacy-compatible",
      cronExpression: "0 9 * * *",
      taskType: "reminder",
      payload: JSON.stringify({ message: "提醒" }),
    });

    expect(task.capabilities).toEqual({
      skillNames: [],
      pluginIds: [],
      connectorIds: [],
      expertId: null,
    });
    db.close();
  });
});
